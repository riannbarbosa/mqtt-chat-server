import {showMenu} from "./menu";
import {MQTTClient} from "./MQTTCli";
import { question } from "./utils";


async function main(){

   console.log('=== MQTT Chat Client ===');
   const userId = await question("Insira o seu ID de usuário: ");
   const brokerUrlDefault = "mosquitto";
   const PORT = "9001";

   console.log(`Usuário: ${userId}, Broker: ${brokerUrlDefault}, Porta: ${PORT}`);

   const client = new MQTTClient(userId, brokerUrlDefault, PORT);

   try{
      await client.connect();

      console.log(`Conectando ao broker MQTT em ${brokerUrlDefault}:${PORT}...`);

      await showMenu(client);

   }
   catch (error) {
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