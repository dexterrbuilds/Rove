import express from 'express';
import cors from 'cors';
import {supabase} from './clients.js';
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

  app.get('/health', async (request, response) => {
    if (request.query.deep !== '1') return response.json({ok: true, service: 'rove-api'});

    try {
      // A deep health check performs a read-only query. It can be used by an uptime
      // monitor to verify both the API and Supabase without creating heartbeat rows.
      const {error} = await supabase
        .from('profiles')
        .select('id', {head: true, count: 'exact'})
        .limit(1);
      if (error) throw error;
      return response.json({ok: true, service: 'rove-api', database: 'reachable'});
    } catch (error) {
      console.error('Deep health check failed:', error);
      return response.status(503).json({ok: false, service: 'rove-api', database: 'unreachable'});
    }
  });
  app.use('/profiles', profileRouter);
  app.use(ussdRouter);
  return app;
}
