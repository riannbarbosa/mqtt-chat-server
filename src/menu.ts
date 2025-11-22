import { question } from './utils';
import { MQTTService } from './services/MQTTService';

export async function showMenu(client: MQTTService) {
  while (true) {
    console.log('Bem-vindo ao MQTT Chat Server!');
    console.log(`
       ==== MQTT Chat =======
        1. Listar usuários e status
        2. Solicitar conversa
        3. Conversas ativas
        4. Solicitações de conversa pendentes
       === OPÇÕES DE GRUPO ==
        5. Criar grupo
        6. Listar grupos
        7. Entrar em um grupo
        8. Gerenciar solicitações de grupo (Líder)
        9. Enviar mensagem no grupo
        10. Ver mensagens 
        11. Excluir grupo (Líder)
       ====== DEBUG =========
        12. Informações de debug
        0. Sair
        `);
    const option = await question('Selecione uma opção: ');

    switch (option) {
      case '1':
        await client.listUsers();
        break;
      case '2':
        await client.requestConversation();
        break;
      case '3':
        await client.handleActiveConversations();
        break;
      case '4':
        await client.handlePendingConversationRequests();
        break;
      case '5':
        await client.createGroup();
        break;
      case '6':
        await client.listGroups();
        break;
      case '7':
        await client.joinGroup();
        break;
      case '8':
        await client.manageGroupRequests();
        break;
      case '9':
        await client.sendGroupMessage();
        break;
      case '10':
        await client.viewGroupMessages();
        break;
      case '11':
        await client.deleteGroup();
        break;
      case '12':
        client.showDebugInfo();
        break;
      case '0':
        console.log('Saindo...');
        try {
          await client.end();
        } catch (error) {
          console.error('Erro ao encerrar:', error);
        }
        return;
      default:
        console.log('Opção inválida');
    }
  }
}
