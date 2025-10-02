<div align="center">
  <img width="293" height="584" alt="image" src="https://github.com/user-attachments/assets/848f59c2-d598-4c2d-9192-816a40847e17" />
  <div><b>+</b></div>
  <img width="120" height="120" alt="image" src="https://github.com/user-attachments/assets/83457577-955e-41c8-8400-aa8e88edf2d5" />
</div>
<h1 align="center">MQTT Chat Server</h1>
<div align="center">
  
![GitHub repo size](https://img.shields.io/github/repo-size/iuricode/README-template?style=for-the-badge)
![GitHub language count](https://img.shields.io/github/languages/count/iuricode/README-template?style=for-the-badge)
  
</div>


## :bulb: Sobre

Este é uma aplicação de chat simples usando Message Queuing Telemetry Transport (MQTT), um protocolo de mensageria para Internet das Coisas (IoT) que usa o modelo publicar/assinar para conectar a um dispositivo.
Este projeto demonstra a comunicação de um chat _one-to-one_ e comunicação em grupo, a comunicação é dada através de um broker MQTT (Mosquitto).


## 🧞 Tecnologias Utilizadas 



## 🚀 Instalando 

Primeiramente de um clone neste repositório ```git clone``` e entra na pasta, em seguida siga estas etapas:

```
# Instale o docker caso não tenha 
$ make docker-install

# Faça a build do projeto
$ make build

# Inicialize o servidor via terminal 
$ make start

# Encerra a execução do projeto/servidor
$ make nuke
```

