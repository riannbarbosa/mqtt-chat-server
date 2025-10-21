import { MQTTService } from '../services/MQTTService';
import {
  Group,
  User,
  GroupInvitation,
  GroupJoinRequest,
  GroupMessage,
} from '../interfaces/interface_config';
import { question } from '../utils';
import { timeStamp } from 'console';

export class GroupController {
  private mqttService: MQTTService;
  private users: Map<string, User>;

  private groups: Map<string, Group>;
  private groupMessages: Map<string, string[]>;

  constructor(mqttService: MQTTService, users: Map<string, User>) {
    this.mqttService = mqttService;
    this.users = users;
    this.groups = new Map();
    this.groupMessages = new Map();
  }

  public async createGroup() {
    const groupName = await question('Nome do grupo: ');

    if (this.groups.has(groupName)) {
      console.log('❌ Já existe um grupo com este nome.');
      return;
    }

    const membersInput = await question('Membros (separados por vírgula, excluindo você): ');
    const members = membersInput
      .split(',')
      .map(m => m.trim())
      .filter(m => m !== this.mqttService.getUserId());

    const allMembers = [this.mqttService.getUserId(), ...members];

    const groupTopic = `GROUP_${groupName}`;
    const group: Group = {
      name: groupName,
      leader: this.mqttService.getUserId(),
      members: allMembers,
      topic: groupTopic,
    };

    this.groups.set(groupName, group);
    this.groupMessages.set(groupTopic, []);

    this.mqttService.subscribe(groupTopic);

    this.mqttService.publishRetained(
      'GROUPS',
      JSON.stringify({
        type: 'group_created',
        ...group,
        timestamp: Date.now(),
      })
    );

    members.forEach(m => {
      this.mqttService.publish(
        `${m}_Control`,
        JSON.stringify({
          type: 'group_invitation',
          groupName: groupName,
          from: this.mqttService.getUserId(),
          to: m,
          topic: groupTopic,
          timeStamp: Date.now(),
        })
      );
    });
    console.log(`✅ Grupo "${groupName}" criado com sucesso!`);
    console.log(`📢 Tópico do grupo: ${groupTopic}`);
    console.log(`👥 Membros: ${allMembers.join(', ')}`);
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
      console.log('─'.repeat(40));
    });

    console.log(`Total de grupos: ${this.groups.size}\n`);
  }

  public handleControlMessage(data: any) {
    if (data.type === 'group_invitation') {
      this.handleGroupInvitation(data);
    } else if (data.type === 'group_request') {
      this.handleGroupJoinRequest(data);
    }
  }

  public isGroupTopic(topic: string): boolean {
    return topic.startsWith('GROUP_');
  }

  public getGroupCount(): number {
    return this.groups.size;
  }
}
//  private handleGroupInvitation(data: any) {

//     console.log(`Convite para grupo recebido de ${data.from} para o grupo ${data.groupName}`);
//     // Implementation for handling group invitations

// }

//  async createGroup() {
//     await this.groupController.createGroup();
//   }

//   async listGroups() {
//     await this.groupController.listGroups();
//   }
