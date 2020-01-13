FROM node:alpine
WORKDIR /app
COPY index.js package.json yarn.lock /app/
RUN apk add --no-cache bash && yarn

EXPOSE 3000
ENTRYPOINT ["yarn"]
CMD ["start"]
