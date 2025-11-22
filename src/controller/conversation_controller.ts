import { MQTTService } from '../services/MQTTService';
import { ConversationRequest, User } from '../interfaces/interface_config';
import { question } from '../utils';
import moment from 'moment';

export class ConversationController {
  private mqttService: MQTTService;
  private users: Map<string, User>;

  private activeConversations: Map<string, string[]>; // Map<userId, topic>
  private currentConversationTopic: string | null = null;
  private pendingRequests: ConversationRequest[];

  constructor(mqttService: MQTTService, users: Map<string, User>) {
    this.mqttService = mqttService;
    this.users = users;
    this.activeConversations = new Map();
    this.pendingRequests = [];
  }

  async requestConversation() {
    const targetUserId = await this.selectedUser();
    if (!targetUserId) return;

    await this.sendConversationRequest(targetUserId);
  }

  private async selectedUser(): Promise<string | null> {
    console.log('\n=== Usuários Online ===');

    const onlineUsers = Array.from(this.users.entries()).filter(
      ([_, user]) => user.status === 'online'
    );

    if (onlineUsers.length === 0) {
      console.log('Nenhum usuário online no momento.');
      return null;
    }

    onlineUsers.forEach(([userId, user]) => {
      const activityInfo = user.lastActivity ? ` | Ativo: ${user.lastActivity}` : ' | Ativo: Agora';
      console.log(`${user.name} - Status: ${user.status}${activityInfo}`);
    });

    const userId = await question('Insira o ID do usuário com quem deseja conversar: ');
    return this.users.has(userId) ? userId : null;
  }

  private async sendConversationRequest(targetUserId: string) {
    if (this.findMyPendingRequestTo(targetUserId)) {
      console.log(`\n⚠️  Você já tem uma solicitação pendente para ${targetUserId}.\n`);
      return;
    }

    this.mqttService.publish(
      `${targetUserId}_Control`,
      JSON.stringify({
        type: 'conversation_request',
        from: this.mqttService.getUserId(),
        to: targetUserId,
        timestamp: Date.now(),
      })
    );

    this.pendingRequests.push({
      from: this.mqttService.getUserId(),
      to: targetUserId,
      timestamp: Date.now(),
      status: 'pendente',
    });

    console.log(`Solicitação de conversa enviada para ${targetUserId}. Aguardando resposta...`);
  }

  async handlePendingRequests() {
    const pendingRequests = this.getPendingRequests();
    if (pendingRequests.length === 0) {
      console.log('Nenhuma solicitação de conversa pendente.');
      return;
    }
    await this.showAndHandleRequests(pendingRequests);
  }

  private getPendingRequests(): ConversationRequest[] {
    const userId = this.mqttService.getUserId();
    return this.pendingRequests.filter(req => req.to === userId && req.status === 'pendente');
  }

  private async showAndHandleRequests(requests: ConversationRequest[]) {
    console.log('\n=== Solicitações de Conversa Pendentes ===');
    requests.forEach((req, index) => {
      console.log(
        `${index + 1}. De: ${req.from} - Enviada em: ${new Date(req.timestamp).toLocaleString()}`
      );
    });
    const choice = await question(
      'Digite o número da solicitação para responder (ou "sair" para cancelar): '
    );
    if (choice.toLowerCase() === 'sair') return;

    const index = parseInt(choice) - 1;
    if (index >= 0 && index < requests.length) {
      await this.handleRequestResponse(requests[index]);
    }
  }

  private async handleRequestResponse(request: ConversationRequest) {
    const response = await question('Aceitar solicitação? (s/n): ');
    if (response.toLowerCase() === 's') {
      this.acceptRequest(request);
    } else {
      this.rejectRequest(request);
    }
  }

  private async acceptRequest(request: ConversationRequest) {
    const topic = `${request.from}_${this.mqttService.getUserId()}_${Date.now()}`;
    request.status = 'aceito';
    request.topic = topic;

    this.activeConversations.set(topic, []);
    this.mqttService.subscribe(topic);

    this.mqttService.publish(
      `${request.from}_Control`,
      JSON.stringify({
        type: 'conversation_response',
        from: this.mqttService.getUserId(),
        to: request.from,
        topic: topic,
        timestamp: Date.now(),
        status: 'aceito',
      })
    );

    console.log(`Conversa iniciada com ${request.from} no tópico ${topic}`);
  }

  private async rejectRequest(request: ConversationRequest) {
    request.status = 'rejeitado';
    this.mqttService.publish(
      `${request.from}_Control`,
      JSON.stringify({
        type: 'conversation_response',
        from: this.mqttService.getUserId(),
        to: request.from,
        timestamp: Date.now(),
        status: 'rejeitado',
      })
    );
    console.log(`Solicitação de conversa de ${request.from} rejeitada.`);
  }

  handleConversationResponse(data: any) {
    const request = this.findPendingRequest(data);
    if (!request) return;
    if (data.status === 'aceito') {
      this.handleAcceptedResponse(request, data);
    } else {
      this.handleRejectedResponse(request, data);
    }
  }

  private findPendingRequest(data: any): ConversationRequest | undefined {
    return this.pendingRequests.find(
      req =>
        req.from === this.mqttService.getUserId() &&
        req.to === data.from &&
        req.status === 'pendente'
    );
  }

  private findMyPendingRequestTo(targetUserId: string): ConversationRequest | undefined {
    return this.pendingRequests.find(
      req =>
        req.from === this.mqttService.getUserId() &&
        req.to === targetUserId &&
        req.status === 'pendente'
    );
  }

  private handleAcceptedResponse(request: ConversationRequest, data: any) {
    request.status = 'aceito';
    request.topic = data.topic;

    this.activeConversations.set(data.topic, []);
    this.mqttService.subscribe(data.topic);

    console.log(`Solicitação de conversa aceita por ${data.from}. Tópico: ${data.topic}`);
  }

  private handleRejectedResponse(request: ConversationRequest, data: any) {
    request.status = 'rejeitado';
    console.log(`Solicitação de conversa rejeitada por ${data.from}.`);
  }

  async handleActiveConversations() {
    console.log('--- Conversas Ativas ---');
    if (this.activeConversations.size === 0) {
      console.log('Nenhuma conversa ativa no momento.');
      return;
    }

    const topics: string[] = [];
    let i = 1;

    this.activeConversations.forEach((messages, topic) => {
      const participants = topic.split('_').slice(0, 2);
      const otherUserId = participants.find(p => p !== this.mqttService.getUserId()) || 'Unknown';
      const otherUser = this.users.get(otherUserId);
      const displayName = otherUser ? `${otherUser.name} (${otherUserId})` : otherUserId;
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : 'Sem mensagens';
      const preview = lastMsg.length > 50 ? lastMsg.substring(0, 47) + '...' : lastMsg;

      console.log(`${i}. Conversa com ${displayName}`);
      console.log(`   ${messages.length} mensagens | Última: ${preview}`);
      topics.push(topic);
      i++;
    });
    console.log('=======================\n');

    const choice = await question('Selecione uma conversa (0 para voltar): ');
    const choiceNum = parseInt(choice);

    if (choiceNum > 0 && choiceNum <= topics.length) {
      await this.enterConversation(topics[choiceNum - 1]);
    }
  }

  private async enterConversation(topic: string) {
    this.currentConversationTopic = topic;

    console.clear();
    console.log(`\n=== Conversa === [Digite '/sair' para voltar]`);

    const messages = this.activeConversations.get(topic) || [];
    if (messages.length > 0) {
      messages.forEach(msg => console.log(msg));
    } else {
      console.log('--- Início da conversa ---');
    }
    console.log('');

    while (true) {
      const message = await question('> ');

      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K');
      if (message === '/sair') {
        console.log('Saindo da conversa...');
        this.currentConversationTopic = null;
        break;
      }

      if (message.trim() === '') continue;

      const timestamp = moment().utcOffset(-180).format('HH:mm');

      console.log(`[${timestamp}] [Você]: ${message}`);

      this.mqttService.publish(
        topic,
        JSON.stringify({
          from: this.mqttService.getUserId(),
          message: message,
          timestamp: Date.now(),
        })
      );

      const updatedMessages = this.activeConversations.get(topic) || [];
      updatedMessages.push(`${this.mqttService.getUserId()}: ${message}`);
      this.activeConversations.set(topic, updatedMessages);
    }
  }

  private handleConversationRequest(data: any) {
    console.log(`\n=== NOVA SOLICITAÇÃO DE CONVERSA ===`);
    console.log(`Usuário: ${data.from}`);
    console.log(`====================================\n`);

    this.pendingRequests.push({
      from: data.from,
      to: this.mqttService.getUserId(),
      timestamp: data.timestamp,
      status: 'pendente',
    });

    console.log(`💬 Nova solicitação de conversa de ${data.from}`);
    console.log(`Use a opção "4". Ver solicitações pendentes' no menu para responder.\n`);
    process.stdout.write('Selecione uma opção: ');
  }

  handleMessage(topic: string, data: any) {
    const isMe = data.from === this.mqttService.getUserId();

    const messages = this.activeConversations.get(topic) || [];
    const timestamp = moment().utcOffset(-180).format('HH:mm');

    let displayName = data.from;
    const getUserFromMap = this.users.get(data.from);
    if (getUserFromMap) {
      displayName = getUserFromMap.name;
    }

    const formattedMessage = `[${timestamp}] ${data.from}: ${data.message}`;
    messages.push(formattedMessage);
    this.activeConversations.set(topic, messages);

    if (isMe) return;

    if (this.currentConversationTopic === topic) {
      process.stdout.write('\r\x1b[K');
      console.log(`[${timestamp}] ${displayName}: ${data.message}`);
      process.stdout.write('> ');
    } else {
      // Outside - show notification
      process.stdout.write('\r\x1b[K');
      console.log(`\n💬 Nova mensagem de ${displayName}: ${data.message}`);
      console.log(`   (Use opção 3 para ver conversas ativas)`);
      process.stdout.write('Selecione uma opção: ');
    }
  }

  handleControlMessage(data: any) {
    if (data.type === 'conversation_request') {
      this.handleConversationRequest(data);
    } else if (data.type === 'conversation_response') {
      this.handleConversationResponse(data);
    }
  }

  restoreConversation(topic: string) {
    if (!this.activeConversations.has(topic)) {
      this.activeConversations.set(topic, []);
      console.log(`✅ Conversa restaurada no tópico: ${topic}`);

      // Notify the user
      const participants = topic.split('_').slice(0, 2);
      const otherUser = participants.find(p => p !== this.mqttService.getUserId()) || 'Unknown';
      console.log(`💬 Você tem uma conversa ativa com ${otherUser}`);
    }
  }

  isActiveConversation(topic: string): boolean {
    return this.activeConversations.has(topic);
  }

  getActiveConversations(): Map<string, string[]> {
    return this.activeConversations;
  }

  getActiveConversationCount(): number {
    return this.activeConversations.size;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.filter(req => req.status === 'pendente').length;
  }
}
