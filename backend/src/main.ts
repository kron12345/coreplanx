import 'dotenv/config';
import { readFileSync } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import yaml from 'js-yaml';
import fastifyMultipart from '@fastify/multipart';

async function bootstrap() {
  const apiPrefix = 'api/v1';
  const fastifyAdapter = new FastifyAdapter({
    bodyLimit: 50 * 1024 * 1024,
    routerOptions: {
      maxParamLength: 512,
    },
  });
  const app = await NestFactory.create(AppModule, fastifyAdapter);
  await fastifyAdapter.getInstance().register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });
  fastifyAdapter.getInstance().addHook('onRequest', (request, reply, done) => {
    const originalUrl = request.raw.url ?? '/';
    const collapsed = originalUrl.replace(/^\/{2,}/, '/');
    // Allow proxies that strip the /api prefix and clean up double slashes.
    if (collapsed === '/v1' || collapsed.startsWith('/v1/')) {
      request.raw.url = `/${apiPrefix}${collapsed.slice('/v1'.length)}`;
    } else {
      request.raw.url = collapsed;
    }
    const headerValue = request.headers['x-request-id'];
    const requestId =
      typeof headerValue === 'string' && headerValue.trim().length > 0
        ? headerValue
        : randomUUID();
    (request as { requestId?: string }).requestId = requestId;
    reply.header('x-request-id', requestId);
    done();
  });
  app.setGlobalPrefix(apiPrefix);
  const allowedOrigins = [
    /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/,
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
      'X-Request-Id',
    ],
    exposedHeaders: ['ETag', 'Location', 'X-Request-Id'],
    maxAge: 3600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Resolve from repository root (frontend + backend share the OpenAPI spec).
  const openApiPath = path.resolve(
    __dirname,
    '..',
    '..',
    'openapi',
    'planning-activities.yaml',
  );
  const openApiRaw = readFileSync(openApiPath, 'utf8');
  const openApiDocument = yaml.load(openApiRaw) as OpenAPIObject;
  SwaggerModule.setup('/api/docs', app, openApiDocument);

  await app.listen(3000, '0.0.0.0');
}
bootstrap();
