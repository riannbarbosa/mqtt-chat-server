global.WebSocket = require('ws');
import paho, { Client } from 'paho-mqtt';
import { Group, User, ConversationRequest } from '../interfaces/interface_config';
import { ConversationController } from '../controller/conversation_controller';
import { GroupController } from '../controller/group_controller';

export class MQTTService {
  private client: Client;
  private userName: string;
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

  constructor(userId: string, userName: string ,brokerUrl: string = 'localhost', port: string = '1883') {
    this.userId = userId;
    this.userName = userName;
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
    return new Promise<boolean>((resolve) => {
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
    console.log('🔄 Solicitando restauração de conversas ativas...');
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

    console.log('📨 Solicitando status de usuários online...');
  }

  private publishOnlineStatus() {
    const message = JSON.stringify({
      type: 'status_update',
      userId: this.userId,
      userName: this.userName,
      status: 'online',
      timestamp: Date.now(),
    });
    this.publishRetained('USERS', message);
  }

  private publishOfflineStatus() {
    const message = JSON.stringify({
      type: 'status_update',
      userId: this.userId,
      userName: this.userName,
      status: 'offline',
      timestamp: Date.now(),
    });
    this.publishRetained('USERS', message);
  }

  private subscribeControlTopics() {
    this.subscribe(`${this.userId}_Control`);

    this.subscribe(`USERS`);
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
    if (this.verificationComplete && !this.userIdConflict) {
      this.publishOfflineStatus();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    this.offlineTimers.forEach((timer, userId) => {
      clearTimeout(timer);
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    this.client.disconnect();
    console.log('Desconectado do broker MQTT');
  }
  isConnected(): boolean {
    return this.client.isConnected();
  }

  async end(): Promise<void> {
    await this.disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }

  onMessageArrived(message: any) {
    const topic = message.destinationName;
    const payload = message.payloadString;

    try {
      const data = JSON.parse(payload);

      if (topic === 'USERS') {
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
      data.type === 'group_join_response'
    ) {
      this.groupController.handleControlMessage(data);
    }
  }

  private handleUserStatusUpdate(data: any) {
    if (data.type === 'status_request' && data.requester !== this.userId) {
      this.publishOnlineStatus();
      return;
    }

    if (data.userId === this.userId) {
      return;
    }

    if (!data.userId) {
      return;
    }

    const existingTimer = this.offlineTimers.get(data.userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.offlineTimers.delete(data.userId);
      console.log(`⏰ Timer de remoção cancelado para ${data.userName || data.userId}`);
    }
    this.users.set(data.userId, {
      id: data.userId,
      name: data.userName,
      status: data.status,
    });

    if (data.status === 'offline') {
      const timer = setTimeout(() => {
        this.users.delete(data.userId);
        this.offlineTimers.delete(data.userId);
        console.log(`🗑️  Usuário [${data.userName}] - ${data.userId} removido da lista (offline há 15s)`);
      }, 15000);
      this.offlineTimers.set(data.userId, timer);
    }
  }

  private handleGroupUpdate(data: any) {
    this.groups.set(data.name, data);
  }

  async listUsers() {
    console.log('\n=== Usuários e Status ===');
    if (this.users.size === 0) {
      console.log('Nenhum outro usuário online no momento.');
      console.log('📨 Solicitando atualizações de status...');

      this.requestCurrentUserStatuses();

      await new Promise(resolve => setTimeout(resolve, 2000));

      if (this.users.size === 0) {
        console.log('Ainda nenhum usuário online.');
      }
    }
    if (this.users.size > 0) {
      this.users.forEach((user, userId) => {
        const statusIcon = user.status === 'online' ? '🟢' : '🔴';
       console.log(`${statusIcon} ${user.name} (ID: ${userId}) - ${user.status}`);
      });
    }

    const onlineCount = [...this.users.values()].filter(u => u.status === 'online').length;

    console.log(`Total de usuários online (excluindo você): ${onlineCount}`);
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
    console.log(`
=== Informações de Debug ===
Usuário: ${this.userName} (ID: ${this.userId})
Broker URL: ${this.brokerUrl}
Porta: ${this.port}
Usuários Online: ${Array.from(this.users.keys()).join(', ')} (${this.users.size})   
Grupos: ${Array.from(this.groups.keys()).join(', ')}
Conversas Ativas: ${this.conversationController.getActiveConversationCount()}
Solicitações de Conversa: ${this.conversationController.getPendingRequestCount()}
Conectado: ${this.isConnected() ? 'Sim' : 'Não'}
=============================
    `);
  }

  public getUserId(): string {
    return this.userId;
  }

    public getUserName(): string { 
    return this.userName;
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

  // async joinGroup() {
  //   await this.groupController.joinGroup();
  // }

  // async sendGroupMessage() {
  //   await this.groupController.sendGroupMessage();
  // }

  // async viewGroupMessages() {
  //   await this.groupController.viewGroupMessages();
  // }
}
