import { question } from "./utils";
import { MQTTClient } from "./MQTTCli";

export async function showMenu(client: MQTTClient) {
  while(true){
    console.log("Bem-vindo ao MQTT Chat Server!");
    console.log(`
        === MQTT Chat ===
        1. Listar usuários e status
        2. Criar grupo
        3. Listar grupos
        4. Solicitar conversa
        5. Informações de debug
        6. Conversas ativas
        7. Solicitações de conversa pendentes
        8. Sair
        `);
       const option = await question("Selecione uma opção: ");

       switch(option) {
            case '1':
                await client.listUsers();
                break;
            case '2':
                await client.createGroup();
                break;
            case '3':
                await client.listGroups();
                break;
            case '4':
                await client.requestConversation();
                break;
            case '5':
                client.showDebugInfo();
                break;
            case '6':
                await client.handleActiveConversations();
                break;
            case '7':
                  await client.handlePendingConversationRequests();
                break;
            case '8':
                console.log('Saindo...');
                client.end();
                process.exit(0);
            default:
                console.log('Opção inválida');
        }
        
  }
}
