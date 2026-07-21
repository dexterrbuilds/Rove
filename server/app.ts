import express from 'express';
import cors from 'cors';
import {getConfig} from './config.js';
import {profileRouter} from './profile-routes.js';
import {ussdRouter} from './ussd.js';

export function createApp() {
  const config = getConfig();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors({origin: config.webOrigin.split(',').map((origin) => origin.trim())}));
  app.use(express.urlencoded({extended: false, limit: '16kb'}));
  app.use(express.json({limit: '16kb'}));

  app.get('/health', (_request, response) => response.json({ok: true, service: 'rove-api'}));
  app.use('/profiles', profileRouter);
  app.use(ussdRouter);
  return app;
}
