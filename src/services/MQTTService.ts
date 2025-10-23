global.WebSocket = require('ws');
import paho, { Client } from 'paho-mqtt';
import { Group, User, ConversationRequest } from '../interfaces/interface_config';
import { ConversationController } from '../controller/conversation_controller';
import { GroupController } from '../controller/group_controller';

export class MQTTService {
  private client: Client;
  private userId: string;
  private brokerUrl: string;
  private port: string;
  // Usuarios online, grupos e conversas ativas

  private conversationRequests: ConversationRequest[];
  private users: Map<string, User>; // Map of userId to online status
  private groups: Map<string, Group>; // Map of groupId to list of userIds

  private conversationController: ConversationController;
  private groupController: GroupController;

  constructor(userId: string, brokerUrl: string = 'localhost', port: string = '1883') {
    this.userId = userId;
    this.brokerUrl = brokerUrl;
    this.port = port;
    this.users = new Map();
    this.groups = new Map();
    this.conversationRequests = [];
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
          this.publishOnlineStatus();
          resolve();
        },
        onFailure: (error: any) => {
          console.error('Falha ao conectar ao broker MQTT:', error);
          reject(error);
        },
      };
      this.client.connect(connectionOptions);
    });
  }

  private publishOnlineStatus(data: any = null) {
    const message = JSON.stringify({
      userId: this.userId,
      status: 'online',
      timestamp: Date.now(),
    });
    this.publishRetained('USERS', message);
  }

  private publishOfflineStatus() {
    const message = JSON.stringify({
      userId: this.userId,
      status: 'offline',
      timestamp: Date.now(),
    });
    this.publishRetained('USERS', message);
  }

  private subscribeControlTopics() {
    this.subscribe(`${this.userId}_Control`);

    this.subscribe(`USERS`);
    this.subscribe(`GROUPS`);
    console.log('✅ Inscrito nos tópicos de controle');
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
    this.publishOfflineStatus();
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
        console.log('Tópico desconhecido:', topic);
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  }

  private handleControlMessage(topic: string, data: any) {
    if (data.type === 'conversation_request' || data.type === 'conversation_response') {
      this.conversationController.handleControlMessage(data);
    } else if (data.type === 'group_invitation' || data.type === 'group_request') {
      this.groupController.handleControlMessage(data);
    }
  }

  private handleUserStatusUpdate(data: any) {
    if (data.userId === this.userId) {
      return;
    }

    this.users.set(data.userId, {
      id: data.userId,
      name: data.userId, // Using ID as name for simplicity
      status: data.status,
    });

    // if (data.status === 'offline') {
    //   setTimeout(() => {
    //     this.users.delete(data.userId);
    //   }, 5000);
    // }
  }

  private handleGroupUpdate(data: any) {
    this.groups.set(data.name, data);
  }

async listUsers() {
  console.log('\n=== Usuários e Status ===');
  if (this.users.size === 0) {
    console.log('Nenhum outro usuário online no momento.');
  } else {
    this.users.forEach((user, userId) => {
      console.log(`Usuário: ${userId}, Status: ${user.status}`);
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
Usuário ID: ${this.userId}
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
