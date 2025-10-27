import { MQTTService } from '../services/MQTTService';
import {
  Group,
  User,
  GroupInvitation,
  GroupJoinRequest,
  GroupJoinResponse,
  GroupUpdate,
} from '../interfaces/interface_config';
import { question } from '../utils';
import { timeStamp } from 'console';

export class GroupController {
  private mqttService: MQTTService;
  private users: Map<string, User>;

  private groups: Map<string, Group>;
  private groupMessages: Map<string, string[]>;
  private pendingJoinRequests: Map<string, GroupJoinRequest[]>;

  constructor(mqttService: MQTTService, users: Map<string, User>) {
    this.mqttService = mqttService;
    this.users = users;
    this.groups = new Map();
    this.groupMessages = new Map();
    this.pendingJoinRequests = new Map();
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
      leader: `${this.mqttService.getUserName()} (${this.mqttService.getUserId()}`,
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
      leader: group.leader,
      members: group.members,
      topic: group.topic,
      timestamp: Date.now(),
    };

    this.mqttService.publishRetained('GROUPS', JSON.stringify(groupUpdate));
    console.log(`✅ Grupo "${groupName}" criado com sucesso!`);
  }

  public async listGroups() {
    console.log('\n=== Grupos Disponíveis ===');

    if (this.groups.size === 0) {
      console.log('Nenhum grupo disponível.');
      return;
    }

    this.groups.forEach((group, groupName) => {
      console.log(`\n🏷️  Nome: ${groupName}`);
      console.log(`👑 Líder: ${group.leader}`);
      console.log(`👥 Membros: ${group.members.join(', ')}`);
      console.log(`📢 Tópico: ${group.topic}`);
      console.log(`💬 Mensagens: ${this.groupMessages.get(group.topic)?.length || 0}`);

      // Show pending requests if user is the leader
      if (group.leader === this.mqttService.getUserId()) {
        const requests = this.pendingJoinRequests.get(groupName) || [];
        console.log(`📨 Solicitações pendentes: ${requests.length}`);
      }

      console.log('─'.repeat(40));
    });

    console.log(`Total de grupos: ${this.groups.size}\n`);
  }

  public async requestToJoinGroup() {
    await this.listGroups();
    const groupName = await question('Nome do grupo que deseja entrar: ');

    const group = this.groups.get(groupName);

    if (!group) {
      console.log('❌ Grupo não encontrado.');
      return;
    }

    const joinRequest: GroupJoinRequest = {
      type: 'group_join_request',
      groupName: groupName,
      from: this.mqttService.getUserId(),
      to: group.leader,
      timestamp: Date.now(),
    };

    this.mqttService.publish(`${group.leader}_Control`, JSON.stringify(joinRequest));
    console.log(`📨 Solicitação de entrada enviada para o líder de "${groupName}".`);
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
    if (!group || group.leader !== this.mqttService.getUserId()) {
      return;
    }

    const requests = this.pendingJoinRequests.get(data.groupName) || [];

    if (!requests.some(req => req.from === data.from)) {
      requests.push(data);
      this.pendingJoinRequests.set(data.groupName, requests);
      console.log(`\n📨 Nova solicitação de entrada em "${data.groupName}" de ${data.from}`);
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
        leader: data.from,
        members: [],
        topic: data.topic,
      };

      this.groups.set(data.groupName, group);
      this.groupMessages.set(data.topic, []);
      console.log(`✅ Você entrou no grupo "${data.groupName}".`);
    }
  }

  public handleGroupUpdate(data: GroupUpdate) {
    this.groups.set(data.name, {
      name: data.name,
      leader: data.leader,
      members: data.members,
      topic: data.topic,
    });

    if (data.members.includes(this.mqttService.getUserId())) {
      this.mqttService.subscribe(data.topic);
      this.groupMessages.set(data.topic, this.groupMessages.get(data.topic) || []);
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
    const formattedMessage = `[${data.from}]: ${data.message}`;
    messages.push(formattedMessage);
    this.groupMessages.set(topic, messages);

    console.log(`\n💬 [GRUPO] ${formattedMessage}`);
    process.stdout.write('Selecione uma opção: ');
  }
}
