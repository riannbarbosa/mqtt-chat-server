FROM debian:latest

RUN apt-get update && apt-get install -y mosquitto mosquitto-clients curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*


COPY package*.json /app/

WORKDIR /app


RUN npm install

COPY client_mqtt /app/src/client_mqtt
COPY server_mqtt /app/src/server_mqtt


EXPOSE 1883 

CMD mosquitto -c /mosquitto/config/mosquitto.conf