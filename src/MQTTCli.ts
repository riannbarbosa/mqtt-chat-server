global.WebSocket = require('ws');
import paho, { Client } from "paho-mqtt";
import { question } from "./utils";
import { request } from "https";

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
                this.handleControlMessage(topic, data);
            }
            else if(this.activeConversations.has(topic)){
            this.handleConversationMessage(topic, data);
         }
            else{
                console.log("Tópico desconhecido:", topic);
            }
        } catch (error) {
            console.error("Erro ao processar mensagem:", error);
        }
    }

    private handleConversationMessage(topic: string, data: any) {
        if(data.from === this.userId){
            return;
        }

        const messages = this.activeConversations.get(topic) || [];
        const formattedMessage = `${data.from}: ${data.message}`;
        messages.push(formattedMessage);
        this.activeConversations.set(topic, messages);
        
        // Mostrar a mensagem em tempo real se estiver na conversa
        console.log(`\n💬 [${topic}] ${formattedMessage}`);
        process.stdout.write("> "); // Reexibe o prompt
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
            // this.handleGroupInvitation(data);
        }
    }

    private handleConversationRequest(data: any) {
        console.log(`\n=== NOVA SOLICITAÇÃO DE CONVERSA ===`);
        console.log(`Usuário: ${data.from}`);
        console.log(`Tópico proposto: ${data.proposedTopic}`);
        console.log(`====================================\n`);

        this.conversationRequests.push({
            from: data.from,
            to: this.userId,
            timestamp: data.timestamp,
            status: 'pendente',
            topic: data.proposedTopic
        });
        console.log(`💬 Nova solicitação de conversa de ${data.from}`);
        console.log(`Use a opção 7. Ver solicitações pendentes' no menu para responder.\n`);

        process.stdout.write("Selecione uma opção: ");
    }

    async handlePendingConversationRequests() {
        const pendingRequests = this.conversationRequests.filter(req => req.to === this.userId && req.status === 'pendente');
        if(pendingRequests.length === 0){
            console.log("Nenhuma solicitação de conversa pendente.");
            return;
        }

        if(pendingRequests.length === 0){
            console.log("Nenhuma solicitação de conversa pendente.");
            return;
        }

        console.log("\n===  SOLICITAÇÕES PENDENTES ===");
        pendingRequests.forEach((req, index) => {   
            console.log(`${index + 1}. De: ${req.from} | Tópico: ${req.topic} | Enviada em: ${new Date(req.timestamp).toLocaleString()}`);
        }
        );
        const choice = await question("Selecione uma solicitação para responder (0 para voltar): ");    
        const choiceNum = parseInt(choice);
        
        if(choiceNum > 0 && choiceNum <= pendingRequests.length){
            const selectedRequest = pendingRequests[choiceNum - 1];
            await this.promptConversationRequestResponse(selectedRequest.from, selectedRequest.topic!);
        }

        
    }

    private async promptConversationRequestResponse(from: string, topic: string) {
        const response = await question(`Aceitar solicitação de conversa de ${from}? (s/n): `);
        if (response.toLowerCase() === 's') {
            this.acceptConversationRequest(from, topic);
            console.log(`Você aceitou a solicitação de conversa de ${from}. Iniciando conversa no tópico ${topic}`);
        }else {
            this.rejectConversationRequest(from);
            console.log(`Você rejeitou a solicitação de conversa de ${from}.`);
        }

    }

    private acceptConversationRequest(from: string, topic: string) {
       const newTopic = `${from}_${this.userId}_${Date.now()}`;
    this.subscribe(newTopic);


        const request = this.conversationRequests.find(req => req.from === from && req.status === 'pendente');
        if (request) {
            request.status = 'aceito';
            request.topic = newTopic;

            this.activeConversations.set(newTopic, []);

            console.log(`Iniciando conversa com ${from} no tópico ${newTopic}`);


            this.publish(`${from}_Control`, JSON.stringify({
                type: 'conversation_response',
                from: this.userId,
                to: from,
                topic: newTopic,
                timestamp: Date.now(),
                status: 'aceito',
                response: 'accepted'
            }));
        }
    }

     private rejectConversationRequest(from: string) {
        const request = this.conversationRequests.find(req => req.from === from && req.status === 'pendente');
        if (request) {
            request.status = 'rejeitado';
            
            this.publish(`${from}_Control`, JSON.stringify({
                type: 'conversation_response',
                from: this.userId,
                to: from,
                timestamp: Date.now(),
                status: 'rejeitado',
                response: 'rejected'
            }));

            console.log(`Solicitação de conversa de ${from} rejeitada.`);
            
        }
    }


     private handleConversationResponse(data: any) {
        const request = this.conversationRequests.find(req => req.from === this.userId && req.to === data.from && req.status === 'pendente');   
        if (request && data.status === 'aceito') {
            request.status = 'aceito';
            request.topic = data.topic;

            this.activeConversations.set(data.topic, []);
            this.subscribe(data.topic);

            console.log(`Sua solicitação de conversa foi aceita por ${data.from}. Iniciando conversa no tópico ${data.topic}`);
        }
        else{
            request!.status = 'rejeitado';  
            console.log(`Sua solicitação de conversa foi rejeitada por ${data.from}.`);
        }
    }

    //  private handleGroupInvitation(data: any) {

    //     console.log(`Convite para grupo recebido de ${data.from} para o grupo ${data.groupName}`);
    //     // Implementation for handling group invitations

        
    // }

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

        this.publish(`${targetUserId}_Control`, JSON.stringify({
        type: 'conversation_request',
        from: this.userId,
        to: targetUserId,
        // ❌ Remover: proposedTopic: topic,
        timestamp: Date.now()
      }));

        // Assina o tópico de conversa
        // assina o topico de nome X_Y_timestamp
        // const topic = `${this.userId}_${targetUserId}_${Date.now()}`;

        // this.publish(`${targetUserId}_Control`, JSON.stringify({
        //     type: 'conversation_request',
        //     from: this.userId,
        //     to: targetUserId,
        //     proposedTopic: topic,
        //     timestamp: Date.now()
        // }));

        this.conversationRequests.push({
            from: this.userId,
            to: targetUserId,
            timestamp: Date.now(),
            status: 'pendente',
            // topic: topic
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
   async handleActiveConversations() {
        // Implementation for handling active conversations
        console.log('--- Conversas Ativas ---');
        if(this.activeConversations.size === 0){
            console.log("Nenhuma conversa ativa no momento.");
            return;
        }
        let i = 1;
        const topics: string[] = [];
          this.activeConversations.forEach((messages, topic) => {
            const participants = topic.split('_').slice(0, 2);
            const otherUser = participants.find(p => p !== this.userId) || 'Unknown';
            
            console.log(`${i}. Conversa com ${otherUser} (${messages.length} mensagens)`);
            topics.push(topic);
            i++;
        });
          console.log("=======================\n");
        
        const choice = await question("Selecione uma conversa (0 para voltar): ");
        const choiceNum = parseInt(choice);
        
        if (choiceNum > 0 && choiceNum <= topics.length) {
            await this.enterConversation(topics[choiceNum - 1]);
        }
    }

    private async enterConversation(topic: string) {
      console.log(`\n=== Conversa === [Digite '/sair' para voltar]`);
      
      const messages  = this.activeConversations.get(topic) || [];

      messages.forEach(msg => console.log(msg));

      while (true) {
        const message = await question("> ");
        if (message === '/sair') {
            console.log("Saindo da conversa...");
            break;
        }

         this.publish(topic, JSON.stringify({
                from: this.userId,
                message: message,
                timestamp: Date.now()
            }));
            const updatedMessages = this.activeConversations.get(topic) || [];  
             updatedMessages.push(`${this.userId}: ${message}`);
             this.activeConversations.set(topic, updatedMessages);
        }
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
