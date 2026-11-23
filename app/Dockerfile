FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public

# Carpeta de datos (en docker-compose.yml se monta ./datos aquí, compartida entre los 3 nodos)
RUN mkdir -p /app/data

ENV PORT=9095
EXPOSE 9095

CMD ["node", "server.js"]
