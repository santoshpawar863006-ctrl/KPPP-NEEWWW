'use strict';

import baseWorker from './index.js';
import { handleBidAi } from './bid-ai.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/bid_ai') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,X-KPPP-Bid-AI'
          }
        });
      }
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ success: false, message: 'Use POST for AI bid review.' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      return handleBidAi(request, env, ctx);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
