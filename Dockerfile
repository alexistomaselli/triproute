# Build stage
FROM node:20-alpine as build-stage

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Easypanel will provide these at build time
ARG VITE_API_KEY
ENV VITE_API_KEY=$VITE_API_KEY

RUN npm run build

# Production stage
FROM nginx:stable-alpine as production-stage

COPY --from=build-stage /app/dist /usr/share/nginx/html

# Default nginx config
RUN printf "server { \n\
    listen 80; \n\
    location / { \n\
    root /usr/share/nginx/html; \n\
    index index.html index.htm; \n\
    try_files \$uri \$uri/ /index.html; \n\
    } \n\
    }" > /etc/nginx/conf.d/default.conf

EXPOSE 80

# Script to inject the API Key into index.html at runtime
# This handles both GEMINI_API_KEY and VITE_API_KEY
CMD ["/bin/sh", "-c", "VAL=${GEMINI_API_KEY:-$VITE_API_KEY} && sed -i \"s/__VITE_API_KEY_PLACEHOLDER__/$VAL/g\" /usr/share/nginx/html/index.html && nginx -g 'daemon off;'"]
