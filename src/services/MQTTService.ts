global.WebSocket = require('ws');
import paho, { Client } from 'paho-mqtt';
import { Group, User, ConversationRequest } from '../interfaces/interface_config';
import { ConversationController } from '../controller/conversation_controller';
import { GroupController } from '../controller/group_controller';
import moment from 'moment';
export class MQTTService {
  private client: Client;
  private userId: string;
  private brokerUrl: string;
  private port: string;
  // Usuarios online, grupos e conversas ativas

  private users: Map<string, User>; // Map of userId to online status
  private groups: Map<string, Group>; // Map of groupId to list of userIds

  private conversationController: ConversationController;
  private groupController: GroupController;

  private offlineTimers: Map<string, NodeJS.Timeout> = new Map();

  private userIdConflict: boolean = false;
  private verificationComplete: boolean = false;

  constructor(userId: string, brokerUrl: string = 'localhost', port: string = '1883') {
    this.userId = userId;
    this.brokerUrl = brokerUrl;
    this.port = port;
    this.users = new Map();
    this.groups = new Map();
    this.offlineTimers = new Map();
    this.client = new Client(this.brokerUrl, Number(this.port), this.userId);
    // Controle de conversas
    this.conversationController = new ConversationController(this, this.users);
    // Controle de grupos
    this.groupController = new GroupController(this, this.users);

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Setup callbacks with proper property names and function references
    this.client.onConnectionLost = this.onConnectionLost.bind(this);
    // this.client.onDisconnect = this.onDisconnect.bind(this);
    this.client.onMessageArrived = this.onMessageArrived.bind(this);
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const connectionOptions = {
        cleanSession: false,
        timeout: 30,
        onSuccess: () => {
          console.log('Conectado ao broker MQTT');
          this.subscribeControlTopics();
          setTimeout(() => {
            this.publishOnlineStatus();
            this.requestCurrentUserStatuses();
            this.restoreActiveConversations();
            this.groupController.initializeGroupSync();
            resolve();
          }, 500);
        },
        onFailure: (error: any) => {
          console.error('Falha ao conectar ao broker MQTT:', error);
          reject(error);
        },
      };
      this.client.connect(connectionOptions);
    });
  }

  async verifyUserIdAvailability(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      setTimeout(() => {
        const existingUser = this.users.get(this.userId);

        if (existingUser && existingUser.status === 'online') {
          this.userIdConflict = true;
          resolve(false);
        } else {
          this.publishOnlineStatus();
          this.verificationComplete = true;
          resolve(true);
        }
      }, 2000);
    });
  }

  private restoreActiveConversations() {
    this.publish(
      `${this.userId}_Control`,
      JSON.stringify({
        type: 'restore_conversations_request',
        from: this.userId,
        timestamp: Date.now(),
      })
    );
  }

  private requestCurrentUserStatuses() {
    this.publish(
      'USERS',
      JSON.stringify({
        type: 'status_request',
        requester: this.userId,
        timestamp: Date.now(),
      })
    );
  }

  private publishOnlineStatus() {
    if (!this.isConnected()) {
      console.log('⚠️  Não conectado, não é possível publicar status online');
      return;
    }

    const message = JSON.stringify({
      type: 'status_update',
      userId: this.userId,
      status: 'online',
      timestamp: Date.now(),
      lastActivity: moment().utcOffset(-180).format('DD/MM/YYYY HH:mm:ss'),
    });
    try {
      this.publishRetained(`USERS/${this.userId}`, message);
    } catch (error) {
      console.error('❌ Erro ao publicar status online:', error);
    }
  }

  private publishOfflineStatus() {
    if (!this.isConnected()) {
      return;
    }

    const message = JSON.stringify({
      type: 'status_update',
      userId: this.userId,
      status: 'offline',
      timestamp: Date.now(),
      lastActivity: moment().utcOffset(-180).format('DD/MM/YYYY HH:mm:ss'),
    });
    this.publishRetained(`USERS/${this.userId}`, message);
  }

  private subscribeControlTopics() {
    this.subscribe(`${this.userId}_Control`);

    this.subscribe(`USERS/+`);
    this.subscribe(`GROUPS`);
  }

  subscribe(topic: string) {
    this.client.subscribe(topic, {
      qos: 1,
      onSuccess: () => {
        console.log(`✅ Inscrito no tópico: ${topic}`);
      },
    });
  }

  onConnectionLost(responseObject: any) {
    console.log('Connection lost:', responseObject.errorMessage);
  }
  async disconnect(): Promise<void> {
    this.offlineTimers.forEach((timer, userId) => {
      clearTimeout(timer);
      console.log(`🧹 Timer limpo para ${userId}`);
    });
    this.offlineTimers.clear();

    if (this.isConnected()) {
      this.publishOfflineStatus();
      // Dar tempo para a mensagem ser enviada
      await new Promise(resolve => setTimeout(resolve, 500));
      this.client.disconnect();
    }

    console.log('Desconectado do broker MQTT');
  }
  isConnected(): boolean {
    return this.client.isConnected();
  }

  async end(): Promise<void> {
    if (this.isConnected()) {
      this.publishOfflineStatus();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await this.disconnect();

    console.log('Encerrando aplicação...');
    process.exit(0);
  }

  onMessageArrived(message: any) {
    const topic = message.destinationName;
    const payload = message.payloadString;

    try {
      const data = JSON.parse(payload);

      if (topic.startsWith('USERS/')) {
        this.handleUserStatusUpdate(data);
      } else if (topic === 'GROUPS') {
        this.handleGroupUpdate(data);
      } else if (topic.endsWith('_Control')) {
        this.handleControlMessage(topic, data);
      } else if (this.conversationController.isActiveConversation(topic)) {
        this.conversationController.handleMessage(topic, data);
      } else if (this.groupController.isGroupTopic(topic)) {
        this.groupController.handleMessage(topic, data);
      } else {
        this.handleUnknownConversationTopic(topic, data);
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  }

  private handleUnknownConversationTopic(topic: string, data: any) {
    const parts = topic.split('_');
    if (parts.length === 3 && !isNaN(Number(parts[2]))) {
      const participants = parts.slice(0, 2);

      if (participants.includes(this.userId)) {
        console.log(`🔄 Restaurando conversa no tópico: ${topic}`);
        this.conversationController.restoreConversation(topic);

        if (data.message) {
          this.conversationController.handleMessage(topic, data);
        }
        return;
      }
    }
  }

  private handleControlMessage(topic: string, data: any) {
    if (data.type === 'conversation_request' || data.type === 'conversation_response') {
      this.conversationController.handleControlMessage(data);
    } else if (
      data.type === 'group_invitation' ||
      data.type === 'group_join_request' ||
      data.type === 'group_join_response' ||
      data.type === 'groups_sync_request'
    ) {
      this.groupController.handleControlMessage(data);
    }
  }

  private handleUserStatusUpdate(data: any) {
    if (!data.type || !data.userId) {
      return;
    }

    // if (data.type === 'status_request' && data.requester !== this.userId) {
    //   console.log(`📨 Recebida solicitação de status de ${data.requester}`);
    //   this.publishOnlineStatus();
    //   return;
    // }

    if (data.userId === this.userId) {
      return;
    }
    const previousStatus = this.users.get(data.userId)?.status;

    const lastActivity =
      data.lastActivity || moment().utcOffset(-180).format('DD/MM/YYYY HH:mm:ss');

    this.users.set(data.userId, {
      id: data.userId,
      name: data.userId,
      status: data.status,
      lastActivity,
    });

    if (previousStatus !== data.status) {
      const userName = data.userId;
      if (data.status === 'online') {
        console.log(`\n✅ ${userName} está online`);
        process.stdout.write('Selecione uma opção: ');
      } else if (data.status === 'offline') {
        console.log(`\n❌ ${userName} está offline`);
        process.stdout.write('Selecione uma opção: ');
      }
    }

    const existingTimer = this.offlineTimers.get(data.userId);

    if (data.status === 'online') {
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.offlineTimers.delete(data.userId);
      }
    } else if (data.status === 'offline') {
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        const currentUser = this.users.get(data.userId);
        if (currentUser && currentUser.status === 'offline') {
          this.users.delete(data.userId);
          this.offlineTimers.delete(data.userId);
          console.log(`🗑️ ${data.userId} removido da lista (offline)`);
        }
      }, 3600000);

      this.offlineTimers.set(data.userId, timer);
    }
  }

  private handleGroupUpdate(data: any) {
    this.groupController.handleGroupUpdate(data);
    this.groups.set(data.name, data);
  }

  async listUsers() {
    console.log('\n=== Usuários e Status ===');

    // this.requestCurrentUserStatuses();

    await new Promise(resolve => setTimeout(resolve, 3000));

    const onlineUsers = Array.from(this.users.entries()).filter(
      ([userId, user]) => user.status === 'online' && userId !== this.userId
    );

    if (onlineUsers.length === 0) {
      console.log('Nenhum outro usuário online no momento.');

      this.requestCurrentUserStatuses();

      await new Promise(resolve => setTimeout(resolve, 2000));

      const updatedOnlineUsers = Array.from(this.users.entries()).filter(
        ([userId, user]) => user.status === 'online' && userId !== this.userId
      );

      const updatedOfflineUsers = Array.from(this.users.entries()).filter(
        ([userId, user]) => user.status === 'offline' && userId !== this.userId
      );

      if (updatedOnlineUsers.length === 0 && updatedOfflineUsers.length === 0) {
        console.log('Ainda nenhum usuário online.');
      } else {
        if (updatedOnlineUsers.length > 0) {
          console.log('\n--- Usuários Online ---');

          updatedOnlineUsers.forEach(([userId, user]) => {
            const activityInfo = user.lastActivity
              ? ` | Última atividade: ${user.lastActivity}`
              : ' | Atividade: Desconhecida';
            console.log(`🟢 ${user.name} (ID: ${userId}) ${activityInfo}`);
          });
        }
        if (updatedOfflineUsers.length > 0) {
          console.log('\n--- Usuários Offline ---');
          updatedOfflineUsers.forEach(([userId, user]) => {
            const activityInfo = user.lastActivity
              ? ` | Última atividade: ${user.lastActivity}`
              : ' | Atividade: Desconhecida';
            console.log(`🔴 ${user.name} ${activityInfo}`);
          });
        }
      }
    } else {
      console.log('\n--- Usuários Online ---');
      onlineUsers.forEach(([userId, user]) => {
        console.log(`🟢 ${user.name}  ${user.lastActivity}`);
      });

      const offlineUsers = Array.from(this.users.entries()).filter(
        ([userId, user]) => user.status === 'offline' && userId !== this.userId
      );

      if (offlineUsers.length > 0) {
        console.log('\n--- Usuários Offline ---');
        offlineUsers.forEach(([userId, user]) => {
          console.log(`🔴 ${user.name} ${user.lastActivity}`);
        });
      }
    }

    console.log(`\nTotal de usuários online: ${onlineUsers.length}`);
    console.log('=========================\n');
  }

  async requestConversation() {
    await this.conversationController.requestConversation();
  }

  async handlePendingConversationRequests() {
    await this.conversationController.handlePendingRequests();
  }

  async handleActiveConversations() {
    await this.conversationController.handleActiveConversations();
  }

  showDebugInfo() {
    const usersList = Array.from(this.users.keys());
    const groupsList = Array.from(this.groups.keys());

    console.log(`
=== Informações de Debug ===
Usuário: ${this.userId}
Broker URL: ${this.brokerUrl}
Porta: ${this.port}
Conectado: ${this.isConnected() ? '✅ Sim' : '❌ Não'}

--- Dados em Memória ---
Usuários Online (${this.users.size}): ${usersList.length > 0 ? usersList.join(', ') : 'Nenhum'}
Grupos Conhecidos (${this.groups.size}): ${groupsList.length > 0 ? groupsList.join(', ') : 'Nenhum'}

--- Estatísticas ---
Conversas Ativas: ${this.conversationController.getActiveConversationCount()}
Solicitações de Conversa: ${this.conversationController.getPendingRequestCount()}
=============================
    `);
  }

  public getUserId(): string {
    return this.userId;
  }

  public publish(topic: string, message: string) {
    const mqttMessage = new paho.Message(message);
    mqttMessage.destinationName = topic;
    mqttMessage.qos = 1;
    this.client.send(mqttMessage);
  }

  public publishRetained(topic: string, message: string) {
    const mqttMessage = new paho.Message(message);
    mqttMessage.destinationName = topic;
    mqttMessage.retained = true;
    this.client.send(mqttMessage);
  }

  // ------------- CHAT EM GRUPO ------------------------------------

  async createGroup() {
    await this.groupController.createGroup();
  }

  async listGroups() {
    await this.groupController.listGroups();
  }

  async joinGroup() {
    await this.groupController.requestToJoinGroup();
  }
  async manageGroupRequests() {
    await this.groupController.manageGroupRequests();
  }

  async sendGroupMessage() {
    await this.groupController.sendGroupMessage();
  }

  async viewGroupMessages() {
    await this.groupController.viewGroupMessages();
  }

  async deleteGroup() {
    await this.groupController.deleteGroup();
  }
}
