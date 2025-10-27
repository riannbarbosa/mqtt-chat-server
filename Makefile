docker-install:
	sudo apt update
	sudo apt install docker.io
	sudo apt install docker-compose-plugin
	docker compose version

docker-uninstall:
	sudo apt uninstall docker-compose-plugin
	sudo apt uninstall docker.io

build:
	docker compose up --build -d

nuke:
	docker compose down

start:
	docker compose run server