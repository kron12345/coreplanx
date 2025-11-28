import 'dotenv/config';
import { readFileSync } from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import fastifySse from 'fastify-sse-v2';
import yaml from 'js-yaml';

async function bootstrap() {
  const apiPrefix = 'api/v1';
  const fastifyAdapter = new FastifyAdapter();
  await fastifyAdapter.register(fastifySse);
  const app = await NestFactory.create(AppModule, fastifyAdapter);
  fastifyAdapter.getInstance().addHook('onRequest', (request, _reply, done) => {
    const originalUrl = request.raw.url ?? '/';
    const collapsed = originalUrl.replace(/^\/{2,}/, '/');
    // Allow proxies that strip the /api prefix and clean up double slashes.
    if (collapsed === '/v1' || collapsed.startsWith('/v1/')) {
      request.raw.url = `/${apiPrefix}${collapsed.slice('/v1'.length)}`;
    } else {
      request.raw.url = collapsed;
    }
    done();
  });
  app.setGlobalPrefix(apiPrefix);
  const allowedOrigins = [
    /^https?:\/\/localhost(?::\d+)?$/,
    /\.animeland\.de$/,
    /^https:\/\/qnamic\.ortwein\.chat$/,
  ];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const isAllowed = allowedOrigins.some((pattern) => pattern.test(origin));
      callback(
        isAllowed ? null : new Error('Origin not allowed by CORS'),
        isAllowed,
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'If-Match',
      'If-None-Match',
      'X-Requested-With',
      'X-Client-Request-Id',
    ],
    exposedHeaders: ['ETag', 'Location'],
    maxAge: 3600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const openApiPath = path.join(
    process.cwd(),
    'openapi',
    'planning-activities.yaml',
  );
  const openApiRaw = readFileSync(openApiPath, 'utf8');
  const openApiDocument = yaml.load(openApiRaw) as OpenAPIObject;
  SwaggerModule.setup('/api/docs', app, openApiDocument);

  await app.listen(3000, '0.0.0.0');
}
bootstrap();
