global.WebSocket = require('ws');
import paho, { Client } from "paho-mqtt";
import { question } from "./utils";

export interface User {
    id: string;
    name: string;
    status: 'online' | 'offline';
}

export interface Group {
    name: string;
    leader: string;
    members: string[];
}

export interface ConversationRequest{
    from: string;
    to: string;
    timestamp: number;
    status: 'pendente' | 'aceito' | 'rejeitado';
    topic?: string;
}

export class MQTTClient {
    private client: Client;
    private userId: string;
    private brokerUrl: string;
    private port: string;
    // Usuarios online, grupos e conversas ativas

    private conversationRequests: ConversationRequest[];
    private users: Map<string, User>; // Map of userId to online status
    private groups: Map<string, Group>; // Map of groupId to list of userIds
    private activeConversations: Map<string, string[]>; // Map of conversationId to list of messages

    // topicos

    constructor(userId: string, brokerUrl: string = "localhost", port: string = "1883") {
        this.userId = userId;
        this.brokerUrl = brokerUrl;
        this.port = port;
        this.users = new Map();
        this.groups = new Map();
        this.activeConversations = new Map();
        this.conversationRequests = [];
        this.client = new Client(this.brokerUrl, Number(this.port), this.userId);
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
                onSuccess: () => {
                    console.log("Conectado ao broker MQTT");
                    this.subscribeControlTopics();
                    this.publishOnlineStatus();
                    resolve();  
                },
                onFailure: (error: any) => {
                    console.error("Falha ao conectar ao broker MQTT:", error);
                    reject(error);
                }
            };
            this.client.connect(connectionOptions);
        });
    }

    private publishOnlineStatus(data: any = null){ 

        const message = JSON.stringify({
            userId: this.userId,
            status: 'online',
            timestamp: Date.now()
        });
        this.publishRetained('USERS', message);
    }

    private publishOfflineStatus(){
        const message = JSON.stringify({
            userId: this.userId,
            status: 'offline',
            timestamp: Date.now()
        });
        this.publishRetained('USERS', message);
    }

    private subscribeControlTopics() {
       this.subscribe(`${this.userId}_Control`);
       
         this.subscribe(`USERS`);
         this.subscribe(`GROUPS`);
         console.log("✅ Inscrito nos tópicos de controle");
    }



    subscribe(topic: string) {
        this.client.subscribe(topic, {
            onSuccess: () => {
                console.log(`✅ Inscrito no tópico: ${topic}`);
            }
        });
    }


   

    onDisconnect() {
        console.log("Disconnected from MQTT broker");
        // Implementation for disconnecting from the MQTT broker
    }

    onConnectionLost(responseObject: any) {
        console.log("Connection lost:", responseObject.errorMessage);
        // Implementation for handling connection loss
    }

    onMessageArrived(message: any) {
        console.log(`Mensagem recebida no tópico ${message.destinationName}: ${message.payloadString}`);    
        const topic = message.destinationName;
        const payload = message.payloadString;
        
        try{
            const data = JSON.parse(payload);

            if(topic === 'USERS'){
                this.handleUserStatusUpdate(data);
            }
            else if(topic === 'GROUPS'){
                this.handleGroupUpdate(data);   
            }
            else if(topic.endsWith('_Control')){
                this.handleControlMessage(data);
            }
            else{
                console.log("Tópico desconhecido:", topic);
            }
        } catch (error) {
            console.error("Erro ao processar mensagem:", error);
        }
    }
     private handleUserStatusUpdate(data: any) {
        if (data.userId === this.userId) {
            return;
        }
        
        this.users.set(data.userId, {
            id: data.userId,
            name: data.userId, // Using ID as name for simplicity
            status: data.status
        });

        if (data.status === 'offline') {
            setTimeout(() => {
                this.users.delete(data.userId);
            }, 5000); 
        }
    }

    private handleGroupUpdate(data: any) {
        this.groups.set(data.name, data);
    }
    private handleControlMessage(topic: string, data: any) {
        if (data.type === "conversation_request") {
            this.handleConversationRequest(data);
        } else if (data.type === "conversation_response") {
            this.handleConversationResponse(data);
        } else if (data.type === "group_invitation") {
            this.handleGroupInvitation(data);
        }
    }

    private handleConversationRequest(data: any) {
        console.log(`Nova solicitação de conversa de ${data.from}. Tópico: ${data.topic}`);

        this.conversationRequests.push({
            from: data.from,
            to: this.userId,
            timestamp: data.timestamp,
            status: 'pendente',
            topic: data.proposedTotopic
        });
        this.promptConversationRequestResponse(this.conversationRequests[this.conversationRequests.length - 1]);
    }

    private async promptConversationRequestResponse(request: ConversationRequest) {
        const response = await question(`Aceitar solicitação de conversa de ${request.from}? (s/n): `);
        if (response.toLowerCase() === 's') {
            this.acceptCOnversationRequest(request);
            console.log(`Você aceitou a solicitação de conversa de ${request.from}. Iniciando conversa no tópico ${request.topic}`);
        }else {
            this.rejectConversationRequest(request);
            console.log(`Você rejeitou a solicitação de conversa de ${request.from}.`);
        }

    }

    private acceptCOnversationRequest(request: ConversationRequest) {
        request.status = 'aceito';
    }

     private rejectConversationRequest(request: ConversationRequest) {
        request.status = 'rejeitado';
    }


     private handleConversationResponse(data: any) {
    }

     private handleGroupInvitation(data: any) {
    }

    async listUsers() {
        console.log("\n=== Usuários e Status ===");
        if (this.users.size === 0) {
            console.log("Nenhum outro usuário online no momento.");
        } else {
            this.users.forEach((user, userId) => {
                console.log(`Usuário: ${userId}, Status: ${user.status}`);
            });
        }
        console.log(`Total de usuários online (excluindo você): ${this.users.size}`);
        console.log("=========================\n");
    }
    
    createGroup() {
        // Implementation for creating a group
    }
    listGroups() {
        // Implementation for listing groups
    }
    async requestConversation() {
        // request a convesartion here

        await this.listUsers();
        const targetUserId = await question("Insira o ID do usuário com quem deseja conversar: ");

        const user = this.users.get(targetUserId);
        if(!user){
            console.log("Usuário não encontrado ou offline.");
            return;
        }

        if(user.status !== 'online'){
            console.log("Usuário não está online.");
            return;
        }

        // Assina o tópico de conversa
        // assina o topico de nome X_Y_timestamp
        const topic = `${this.userId}_${targetUserId}_${Date.now()}`;

        this.publish(`${targetUserId}_Control`, JSON.stringify({
            type: 'conversation_request',
            from: this.userId,
            to: targetUserId,
            topic: topic,
            timestamp: Date.now()
        }));

        this.conversationRequests.push({
            from: this.userId,
            to: targetUserId,
            timestamp: Date.now(),
            status: 'pendente',
            topic: topic
        });
        
        console.log(`Solicitação de conversa enviada para ${targetUserId}. Aguardando resposta...`);

    }
    showDebugInfo() {
        console.log(`
=== Informações de Debug ===
Usuário ID: ${this.userId}
Broker URL: ${this.brokerUrl}
Porta: ${this.port}
Usuários Online: ${Array.from(this.users.keys()).join(', ')} (${this.users.size})   
Grupos: ${Array.from(this.groups.keys()).join(', ')}
Conversas Ativas: ${Array.from(this.activeConversations.keys()).join(', ')}
Solicitações de Conversa: ${this.conversationRequests.length}
Conectado: ${this.isConnected() ? 'Sim' : 'Não'}
=============================
            
            `)
    }
    handleActiveConversations() {
        // Implementation for handling active conversations
    }


    publish(topic: string, message: string) {
        const mqttMessage = new paho.Message(message);
        mqttMessage.destinationName = topic;
        this.client.send(mqttMessage);
    }

    publishRetained(topic: string, message: string) {
        const mqttMessage = new paho.Message(message);
        mqttMessage.destinationName = topic;
        mqttMessage.retained = true;
        this.client.send(mqttMessage);
    }
    disconnect() {
        this.publishOfflineStatus();
        this.client.disconnect();
        console.log("Desconectado do broker MQTT");
    }
    isConnected(): boolean {
     return this.client.isConnected();
    }

    end() {
        this.disconnect();
        process.exit(0);
    }
}
