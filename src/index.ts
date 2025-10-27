import { showMenu } from './menu';
import { MQTTService } from './services/MQTTService';
import { ConversationController } from './controller/conversation_controller';
import { question } from './utils';

async function main() {
  console.log('=== MQTT Chat Client ===');
  const userId = await question('Insira o seu ID de usuário: ');
  if (!userId) {
    console.log('ID de usuário inválido. Encerrando.');
    process.exit(1);
  }

    const userName = await question('Insira o seu nome de usuário: ');
  if (!userName) {
    console.log('Nome de usuário inválido. Encerrando.');
    process.exit(1);
  }
  const brokerUrlDefault = 'mosquitto';
  const PORT = '9001';


  const client = new MQTTService(userId, userName,brokerUrlDefault, PORT);

  try {
    await client.connect();
    await showMenu(client);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\nEncerrando o cliente MQTT...');
  process.exit(0);
});

process.on('exit', () => {
  console.log('Cliente MQTT encerrado.');
});

main().catch(console.error);
