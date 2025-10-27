FROM node:20-slim

RUN apt-get update && \
    apt-get install -y mosquitto-clients && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*


WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN useradd -m -u 1001 mqttuser && chown -R mqttuser:mqttuser /app
USER mqttuser
# Default command - run the compiled client
CMD ["npm", "start"];  