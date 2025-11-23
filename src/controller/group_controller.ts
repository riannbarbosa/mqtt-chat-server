import { MQTTService } from '../services/MQTTService';
import moment from 'moment';
import {
  Group,
  User,
  GroupInvitation,
  GroupJoinRequest,
  GroupJoinResponse,
  GroupUpdate,
} from '../interfaces/interface_config';
import { question } from '../utils';
import { generateTable } from '../printAsTable';

const COLORS = [
  '\x1b[31m', // Vermelho
  '\x1b[32m', // Verde
  '\x1b[33m', // Amarelo
  '\x1b[34m', // Azul
  '\x1b[35m', // Magenta
  '\x1b[36m', // Ciano
  '\x1b[91m', // Vermelho Claro
  '\x1b[92m', // Verde Claro
  '\x1b[93m', // Amarelo Claro
  '\x1b[94m', // Azul Claro
  '\x1b[95m', // Magenta Claro
  '\x1b[96m', // Ciano Claro
];
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
export class GroupController {
  private mqttService: MQTTService;
  private users: Map<string, User>;

  private groups: Map<string, Group>;
  private groupMessages: Map<string, string[]>;
  private pendingJoinRequests: Map<string, GroupJoinRequest[]>;

  private currentActiveGroupTopic: string | null = null;

  constructor(mqttService: MQTTService, users: Map<string, User>) {
    this.mqttService = mqttService;
    this.users = users;
    this.groups = new Map();
    this.groupMessages = new Map();
    this.pendingJoinRequests = new Map();
  }

  private getUserColor(username: string) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % COLORS.length;
    return COLORS[index];
  }

  public async createGroup() {
    const groupName = await question('Nome do grupo: ');

    if (this.groups.has(groupName)) {
      console.log('❌ Já existe um grupo com este nome.');
      return;
    }

    const groupTopic = `GROUP_${groupName}`;
    const group: Group = {
      name: groupName,
      leaderId: this.mqttService.getUserId(),
      members: [this.mqttService.getUserId()],
      topic: groupTopic,
    };

    this.groups.set(groupName, group);
    this.groupMessages.set(groupTopic, []);
    this.pendingJoinRequests.set(groupName, []);

    this.mqttService.subscribe(groupTopic);

    const groupUpdate: GroupUpdate = {
      type: 'group_created',
      name: group.name,
      leaderId: group.leaderId,
      members: group.members,
      topic: group.topic,
      timestamp: Date.now(),
    };

    this.mqttService.publishRetained('GROUPS', JSON.stringify(groupUpdate));
    console.log(`✅ Grupo "${groupName}" criado com sucesso!`);
  }

  public initializeGroupSync() {
    this.mqttService.publish(
      'GROUPS',
      JSON.stringify({
        type: 'groups_sync_request',
        requester: this.mqttService.getUserId(),
        timestamp: Date.now(),
      })
    );
  }
  public async listGroups() {
    console.log('\n=== Grupos Disponíveis ===');

    if (this.groups.size === 0) {
      console.log('Nenhum grupo disponível.');
      console.log('🔄 Solicitando sincronização de grupos...');

      this.initializeGroupSync();

      await new Promise(resolve => setTimeout(resolve, 2000));

      if (this.groups.size === 0) {
        console.log('Ainda nenhum grupo disponível.');
      }
    }
    if (this.groups.size > 0) {
      this.groups.forEach((group, groupName) => {
        const isMember = group.members.includes(this.mqttService.getUserId());
        const isLeader = group.leaderId === this.mqttService.getUserId();

        generateTable([
          {
            Nome: `${groupName}`,
            Líder: `${group.leaderId}`,
            Membros: `${group.members.length > 0 ? group.members.join(', ') : group.members[0]}`,
            Tópico: `${group.topic}`,
            Mensagens: `${this.groupMessages.get(group.topic)?.length || 0}`,
            Status: `${isMember ? 'Membro' : 'Não membro'} ${isLeader ? '| Líder' : ''}`,
          },
        ]).printTable();

        if (isLeader) {
          const requests = this.pendingJoinRequests.get(groupName) || [];
          console.log(`📨 Solicitações pendentes: ${requests.length}`);
        }

        console.log('─'.repeat(40));
      });

      console.log(`Total de grupos: ${this.groups.size}\n`);

      const userGroups = Array.from(this.groups.values()).filter(group =>
        group.members.includes(this.mqttService.getUserId())
      ).length;

      console.log(`Grupos que você é membro: ${userGroups}`);
    }
    console.log('=========================\n');
  }

  public async requestToJoinGroup() {
    await this.listGroups();
    const groupName = await question('Nome do grupo que deseja entrar: ');
    const userId = this.mqttService.getUserId();

    const group = this.groups.get(groupName);

    if (!group) {
      console.log('❌ Grupo não encontrado.');
      return;
    }

    if (group.members.includes(userId)) {
      console.log('✅ Você já é membro deste grupo!');
      return;
    }

    if (group.leaderId === userId) {
      console.log('👑 Você é o líder deste grupo!');
      return;
    }

    const joinRequest: GroupJoinRequest = {
      type: 'group_join_request',
      groupName: groupName,
      from: userId,
      to: group.leaderId,
      timestamp: Date.now(),
    };

    this.mqttService.publish(`${group.leaderId}_Control`, JSON.stringify(joinRequest));
    console.log(`📨 Solicitação de entrada enviada para o líder de "${groupName}".`);
  }
  public async manageGroupRequests() {
    const userGroups = Array.from(this.groups.values()).filter(
      group => group.leaderId === this.mqttService.getUserId()
    );

    if (userGroups.length === 0) {
      console.log('❌ Você não é líder de nenhum grupo.');
    }
    console.log('\n=== Gerenciar Solicitações de Grupo ===');

    let hasRequests = false;

    userGroups.forEach(g => {
      const requests = this.pendingJoinRequests.get(g.name) || [];
      if (requests.length > 0) {
        hasRequests = true;
        console.log(`\n🏷️  Grupo: ${g.name}`);
        requests.forEach((req, index) => {
          const requestingUser = this.users.get(req.from);
          const userName = requestingUser ? requestingUser.name : req.from;
          console.log(
            `   ${index + 1}. ${userName} - ${new Date(req.timestamp).toLocaleTimeString()}`
          );
        });
      }
    });

    if (!hasRequests) {
      console.log('Nenhuma solicitação pendente.');
      return;
    }

    const groupName = await question('\nNome do grupo para gerenciar: ');
    await this.manageSingleGroupRequests(groupName);
  }

  private async manageSingleGroupRequests(groupName: string) {
    const group = this.groups.get(groupName);
    if (!group || group.leaderId !== this.mqttService.getUserId()) {
      console.log('❌ Grupo não encontrado ou você não é o líder.');
      return;
    }

    const requests = this.pendingJoinRequests.get(groupName) || [];
    if (requests.length === 0) {
      console.log('❌ Nenhuma solicitação para este grupo.');
      return;
    }

    console.log(`\n=== Solicitações para ${groupName} ===`);

    requests.forEach((req, index) => {
      const requestingUser = this.users.get(req.from);
      const userName = requestingUser ? requestingUser.name : req.from;
      console.log(`${index + 1}. ${userName} (${req.from})`);
    });
    const choice = await question('\nSelecione a solicitação (número) ou "0" para voltar: ');
    const choiceNum = parseInt(choice);

    if (choiceNum > 0 && choiceNum <= requests.length) {
      const selectedRequest = requests[choiceNum - 1];
      await this.handleSingleRequest(groupName, selectedRequest);
    }
  }

  private async handleSingleRequest(groupName: string, request: GroupJoinRequest) {
    const requestingUser = this.users.get(request.from);
    const userName = requestingUser ? requestingUser.name : request.from;

    const response = await question(`Aceitar ${userName} no grupo "${groupName}"? (s/n): `);

    if (response.toLowerCase() === 's') {
      this.acceptJoinRequest(groupName, request);
    } else {
      this.rejectJoinRequest(groupName, request);
    }
  }

  private acceptJoinRequest(groupName: string, request: GroupJoinRequest) {
    const group = this.groups.get(groupName);
    if (!group) return;

    if (!group.members.includes(request.from)) {
      group.members.push(request.from);
    }

    // Remover da lista de pendentes
    const requests = this.pendingJoinRequests.get(groupName) || [];
    const updatedRequests = requests.filter(req => req.from !== request.from);
    this.pendingJoinRequests.set(groupName, updatedRequests);

    const groupUpdate: GroupUpdate = {
      type: 'group_updated',
      name: group.name,
      leaderId: group.leaderId,
      members: group.members,
      topic: group.topic,
      timestamp: Date.now(),
    };

    this.mqttService.publishRetained('GROUPS', JSON.stringify(groupUpdate));

    // Notificar o usuário que foi aceito
    const joinResponse: GroupJoinResponse = {
      type: 'group_join_response',
      groupName: groupName,
      from: this.mqttService.getUserId(),
      to: request.from,
      status: 'aceito',
      topic: group.topic,
      timestamp: Date.now(),
    };

    this.mqttService.publish(`${request.from}_Control`, JSON.stringify(joinResponse));

    console.log(`✅ ${request.from} foi adicionado ao grupo "${groupName}".`);
    console.log(`📢 Grupo atualizado no tópico GROUPS.`);
  }

  private rejectJoinRequest(groupName: string, request: GroupJoinRequest) {
    // Remover da lista de pendentes
    const requests = this.pendingJoinRequests.get(groupName) || [];
    const updatedRequests = requests.filter(req => req.from !== request.from);
    this.pendingJoinRequests.set(groupName, updatedRequests);

    const joinResponse: GroupJoinResponse = {
      type: 'group_join_response',
      groupName: groupName,
      from: this.mqttService.getUserId(),
      to: request.from,
      status: 'rejeitado',
      timestamp: Date.now(),
    };

    this.mqttService.publish(`${request.from}_Control`, JSON.stringify(joinResponse));

    console.log(`❌ Solicitação de ${request.from} foi rejeitada.`);
  }

  public handleGroupUpdate(data: any) {
    if (!data || !data.name) return;

    if (data.type === 'group_deleted') {
      console.log(`🗑️ Recebida notificação de exclusão do grupo: ${data.name}`);
      this.groups.delete(data.name);
      this.groupMessages.delete(data.topic);
      this.pendingJoinRequests.delete(data.name);
      return;
    }

    this.groups.set(data.name, {
      name: data.name,
      leaderId: data.leaderId,
      members: data.members || [],
      topic: data.topic,
    });

    if (data.members && data.members.includes(this.mqttService.getUserId())) {
      if (!this.groupMessages.has(data.topic)) {
        this.groupMessages.set(data.topic, []);
      }
      this.mqttService.subscribe(data.topic);
      console.log(`✅ Inscrito no tópico do grupo: ${data.topic}`);
    }

    console.log(`📊 Grupos conhecidos: ${Array.from(this.groups.keys()).join(', ')}`);
  }

  public handleControlMessage(data: any) {
    switch (data.type) {
      case 'group_join_request':
        this.handleIncomingJoinRequest(data as GroupJoinRequest);
        break;
      case 'group_join_response':
        this.handleJoinResponse(data as GroupJoinResponse);
        break;
      case 'group_invitation':
        this.handleGroupInvitation(data as GroupInvitation);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  }

  private handleIncomingJoinRequest(data: GroupJoinRequest) {
    const group = this.groups.get(data.groupName);
    if (!group || group.leaderId !== this.mqttService.getUserId()) {
      return;
    }
    const requests = this.pendingJoinRequests.get(data.groupName) || [];

    if (!requests.some(req => req.from === data.from)) {
      requests.push(data);
      this.pendingJoinRequests.set(data.groupName, requests);
      const requestingUser = this.users.get(data.from);
      const userName = requestingUser ? requestingUser.name : data.from;

      console.log(`\n📨 Nova solicitação de entrada em "${data.groupName}" de ${userName}`);
    }
  }

  private handleJoinResponse(data: GroupJoinResponse) {
    if (data.status === 'aceito' && data.topic) {
      const group = this.groups.get(data.groupName);
      if (group) {
        if (!group.members.includes(this.mqttService.getUserId())) {
          group.members.push(this.mqttService.getUserId());
        }
        this.mqttService.subscribe(data.topic);
        this.groupMessages.set(data.topic, this.groupMessages.get(data.topic) || []);
        console.log(`\n✅ Sua solicitação para o grupo "${data.groupName}" foi aceita!`);
      }
    } else {
      console.log(`\n❌ Sua solicitação para o grupo "${data.groupName}" foi rejeitada.`);
    }
  }

  private handleGroupInvitation(data: GroupInvitation) {
    console.log(`\n=== CONVITE DE GRUPO ===`);
    console.log(`Grupo: ${data.groupName}`);
    console.log(`Convidado por: ${data.from}`);

    if (data.topic) {
      this.mqttService.subscribe(data.topic);
      const group: Group = {
        name: data.groupName,
        leaderId: data.from,
        members: [],
        topic: data.topic,
      };

      this.groups.set(data.groupName, group);
      this.groupMessages.set(data.topic, []);
      console.log(`✅ Você entrou no grupo "${data.groupName}".`);
    }
  }

  public isGroupTopic(topic: string): boolean {
    return topic.startsWith('GROUP_');
  }

  public getGroupCount(): number {
    return this.groups.size;
  }

  public handleMessage(topic: string, data: any) {
    if (data.type === 'group_message') {
      this.handleGroupMessage(topic, data);
    }
  }
  private handleGroupMessage(topic: string, data: any) {
    const messages = this.groupMessages.get(topic) || [];
    const senderUser = this.users.get(data.from);
    const senderName = senderUser ? senderUser.name : data.from;
    const timestamp = moment().utcOffset(-180).format('HH:mm');

    const formattedMessage = `[${timestamp}] [${senderName}]: ${data.message}`;
    messages.push(formattedMessage);
    this.groupMessages.set(topic, messages);

    const isMe = data.from === this.mqttService.getUserId();

    if (isMe) {
      return;
    }

    if (this.currentActiveGroupTopic !== topic) {
      return;
    }

    const userColor = this.getUserColor(senderName);

    process.stdout.write('\r\x1b[K');

    // let groupName = 'Desconhecido';
    // this.groups.forEach((group, name) => {
    //   if (group.topic === topic) {
    //     groupName = name;
    //   }
    // });

    console.log(`\n💬 [${timestamp}] ${userColor}${senderName}${RESET}: ${data.message}`);
    process.stdout.write('> ');
  }

  public async sendGroupMessage() {
    await this.listGroups();
    const groupName = await question('Nome do grupo para enviar mensagem: ');

    const group = this.groups.get(groupName);
    if (!group) {
      console.log('❌ Grupo não encontrado.');
      return;
    }

    if (!group.members.includes(this.mqttService.getUserId())) {
      console.log('❌ Você não é membro deste grupo.');
      return;
    }

    this.currentActiveGroupTopic = group.topic;

    console.clear();
    console.log(`\n=== Chat do Grupo ${groupName} === [Digite '/sair' para voltar]`);

    const messages = this.groupMessages.get(group.topic) || [];
    if (messages.length > 0) {
      messages.forEach(msg => {
        const match = msg.match(/\[(.*?)\] \[(.*?)\]: (.*)/);
        if (match) {
          const [_, time, name, text] = match;
          const color = this.getUserColor(name);
          const displayName =
            name === this.mqttService.getUserId()
              ? `${BOLD}\x1b[32mVocê${RESET}`
              : `${color}${name}${RESET}`;
          console.log(`[${time}] ${displayName}: ${text}`);
        } else {
          console.log(msg);
        }
      });
    } else {
      console.log('--- Início da conversa ---');
    }
    console.log('');

    while (true) {
      const messageText = await question('> ');

      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K');

      if (messageText === '/sair') {
        console.log('Saindo do chat....');
        this.currentActiveGroupTopic = null;
        break;
      }

      if (messageText.trim() === '') {
        continue;
      }

      const timestamp = moment().utcOffset(-180).format('HH:mm');

      console.log(`[${timestamp}] ${BOLD}\x1b[32mVocê${RESET}: ${messageText}`);

      const messageData = {
        type: 'group_message',
        from: this.mqttService.getUserId(),
        message: messageText,
        timestamp: Date.now(),
      };

      this.mqttService.publish(group.topic, JSON.stringify(messageData));
      const senderName =
        this.users.get(this.mqttService.getUserId())?.name || this.mqttService.getUserId();
      const formattedMessage = `[${timestamp}] [${senderName}]: ${messageText}`;

      messages.push(formattedMessage);
      this.groupMessages.set(group.topic, messages);

      // console.log(`[${timestamp}] [Você]: ${messageText}`);
    }
  }

  public async viewGroupMessages() {
    await this.listGroups();
    const groupName = await question('Nome do grupo para ver mensagens: ');

    const group = this.groups.get(groupName);
    if (!group) {
      console.log('❌ Grupo não encontrado.');
      return;
    }

    if (!group.members.includes(this.mqttService.getUserId())) {
      console.log('❌ Você não é membro deste grupo.');
      return;
    }

    const messages = this.groupMessages.get(group.topic) || [];

    console.log(`\n=== Mensagens do Grupo "${groupName}" ===`);
    console.log(`Membros: ${group.members.join(', ')}`);
    console.log(`Total de mensagens: ${messages.length}`);
    console.log('='.repeat(50));

    if (messages.length === 0) {
      console.log('Nenhuma mensagem ainda.');
    } else {
      messages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    }
    console.log('='.repeat(50));

    const choice = await question(
      '\nDigite "entrar" para participar do chat ou Enter para voltar: '
    );
    if (choice.toLowerCase() === 'entrar') {
      await this.sendGroupMessage();
    }
  }

  public async deleteGroup() {
    const userGroups = Array.from(this.groups.values()).filter(
      group => group.leaderId === this.mqttService.getUserId()
    );

    if (userGroups.length === 0) {
      console.log('❌ Você não é líder de nenhum grupo.');
      return;
    }

    console.log('\n=== Grupos que você pode excluir ===');
    userGroups.forEach((group, index) => {
      console.log(`${index + 1}. ${group.name} (Membros: ${group.members.length})`);
    });

    const choice = await question('Número do grupo (0 cancelar): ');

    const choiceNum = parseInt(choice);

    if (choiceNum === 0) {
      return;
    }

    if (choiceNum > 0 && choiceNum <= userGroups.length) {
      const groupToDelete = userGroups[choiceNum - 1];
      await this.confirmAndDeleteGroup(groupToDelete.name);
    } else {
      console.log('❌ Opção inválida.');
    }
  }

  private async confirmAndDeleteGroup(groupName: string) {
    const group = this.groups.get(groupName);
    if (!group) {
      console.log('❌ Grupo não encontrado.');
      return;
    }
    const confirmation = await question(
      `Tem certeza que deseja excluir o grupo "${groupName}"? (s/n): `
    );

    if (confirmation.toLowerCase() !== 's') {
      console.log('Exclusão cancelada.');
      return;
    }

    const groupUpdate: GroupUpdate = {
      type: 'group_deleted',
      name: group.name,
      leaderId: group.leaderId,
      members: group.members,
      topic: group.topic,
      timestamp: Date.now(),
    };

    this.mqttService.publishRetained('GROUPS', JSON.stringify(groupUpdate));

    this.groups.delete(groupName);
    this.groupMessages.delete(group.topic);
    this.pendingJoinRequests.delete(groupName);

    console.log(`✅ Grupo "${groupName}" excluído com sucesso.`);
  }
}
