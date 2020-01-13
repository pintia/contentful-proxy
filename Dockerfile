FROM node:12-slim
WORKDIR /app
COPY index.js package.json yarn.lock /app/
RUN yarn

EXPOSE 3000
ENTRYPOINT ["yarn"]
CMD ["start"]
