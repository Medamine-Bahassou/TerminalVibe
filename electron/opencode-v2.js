'use strict';
// OpenCode 2.x replaced the HTTP API (/api/*, new events). This is a client in the shape of the 1.x SDK that
// chat-sdk.js uses, with 2.x events translated to 1.x ones, so OpenCodeSession works with both.

// One translator per event stream. forms: requestID -> { sessionID, fields }, needed to reply.
function translator(asks = new Map()) {
  const tools = new Map();
  const part = p => [{ type: 'message.part.updated', properties: { sessionID: p.sessionID, part: p } }];
  const text = content => (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return ({ type, data: d = {} }) => {
    const sessionID = d.sessionID;
    const idle = { type: 'session.idle', properties: { sessionID } };
    if (type === 'session.text.ended' || type === 'session.reasoning.ended') {
      const kind = type.split('.')[1];
      return part({ id: `${d.assistantMessageID}:${kind}:${d.ordinal}`, messageID: d.assistantMessageID, sessionID, type: kind, text: d.text, time: { end: 1 } });
    }
    if (type.startsWith('session.tool.')) {
      let t = tools.get(d.id);
      if (type === 'session.tool.input.started') {
        // 2.x calls the task tool "subagent".
        tools.set(d.id, { id: d.id, sessionID, messageID: d.assistantMessageID, type: 'tool', tool: d.name === 'subagent' ? 'task' : d.name, state: { input: {}, metadata: {} } });
        return [];
      }
      if (!t) return [];
      const state = { ...t.state };
      if (type === 'session.tool.called') {
        Object.assign(state, { status: 'running', time: { start: Date.now() },
          input: t.tool === 'task' ? { ...d.input, subagent_type: d.input?.agent } : d.input });
      } else if (type === 'session.tool.progress' || type === 'session.tool.success') {
        const { sessionID: child, ...meta } = d.metadata || {};
        state.metadata = { ...state.metadata, ...meta, ...(child ? { sessionId: child } : {}) };
        if (type === 'session.tool.success') {
          const out = text(d.content);
          state.status = 'completed';
          state.output = t.tool === 'task' ? out.replace(/^<subagent [^>]*>\n?|\n?<\/subagent>\s*$/g, '') : out;
        }
      } else if (type === 'session.tool.failed') {
        Object.assign(state, { status: 'error', error: d.error?.message || 'The tool failed' });
      } else return [];
      if (state.status === 'completed' || state.status === 'error') { state.time = { ...state.time, end: Date.now() }; tools.delete(d.id); }
      t = { ...t, state };
      if (tools.has(d.id)) tools.set(d.id, t);
      return part(t);
    }
    if (type === 'permission.asked') {
      asks.set(d.id, { sessionID });
      return [{ type, properties: { id: d.id, sessionID, permission: d.action, patterns: d.resources, always: d.save, metadata: d.metadata || {} } }];
    }
    if (type === 'permission.replied') return [{ type, properties: d }];
    if (type === 'form.created') {
      const form = d.form || {}, fields = (form.fields || []).filter(f => !f.hidden);
      asks.set(form.id, { sessionID: form.sessionID, fields });
      return [{ type: 'question.asked', properties: { id: form.id, sessionID: form.sessionID, questions: fields.map(f => ({
        question: f.description || f.title || form.title, header: f.title || '', multiple: f.type === 'multiselect',
        options: f.type === 'boolean' ? [{ label: 'Yes' }, { label: 'No' }] : f.options || [] })) } }];
    }
    if (type === 'form.replied' || type === 'form.cancelled') return [{ type: 'question.replied', properties: { sessionID, requestID: d.id } }];
    if (type === 'session.step.failed' || type === 'session.execution.failed') {
      const error = d.error?.type === 'aborted' ? [] : [{ type: 'session.error', properties: { sessionID, error: d.error } }];
      return type === 'session.step.failed' ? error : [...error, idle];
    }
    if (type === 'session.execution.succeeded' || type === 'session.execution.interrupted') return [idle];
    return [];
  };
}

// The 2.x answer to a form: option labels back to their values, typed per field.
const formAnswer = (fields, answers) => Object.fromEntries(fields.map((f, i) => {
  const values = (answers[i] || []).map(label => f.options?.find(o => o.label === label)?.value ?? label);
  return [f.key, f.type === 'multiselect' ? values : f.type === 'boolean' ? values[0] === 'Yes'
    : f.type === 'number' || f.type === 'integer' ? Number(values[0]) : values[0] ?? ''];
}));

function createClient({ baseUrl, headers }) {
  const asks = new Map(), agents = new Map();
  async function api(method, route, { body, directory, signal } = {}) {
    const query = directory ? '?' + new URLSearchParams({ 'location[directory]': directory }) : '';
    const res = await fetch(baseUrl + route + query, { method, signal,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    const raw = await res.text();
    let json = null; try { json = JSON.parse(raw); } catch {}
    if (!res.ok) throw Error(json?.message || json?.error?.message || `OpenCode request failed (${res.status})`);
    return json;
  }
  const at = id => '/api/session/' + encodeURIComponent(id);
  return {
    session: {
      create: ({ directory }) => api('POST', '/api/session', { body: { location: { directory } } }),
      get: ({ sessionID }) => api('GET', at(sessionID)),
      fork: ({ sessionID }) => api('POST', at(sessionID) + '/fork', { body: {} }),
      abort: ({ sessionID }) => api('POST', at(sessionID) + '/interrupt'),
      // In 2.x the model and agent belong to the session, not the prompt.
      async promptAsync({ sessionID, model, agent = 'build', parts }) {
        if (model) await api('POST', at(sessionID) + '/model', { body: { model: { providerID: model.providerID, id: model.modelID } } });
        if (agent !== (agents.get(sessionID) || 'build') || !agents.has(sessionID)) {
          await api('POST', at(sessionID) + '/agent', { body: { agent } });
          agents.set(sessionID, agent);
        }
        const files = parts.filter(p => p.type === 'file').map(p => ({ uri: p.url }));
        await api('POST', at(sessionID) + '/prompt', { body: { text: parts.find(p => p.type === 'text').text, ...(files.length ? { files } : {}) } });
        return {};
      },
    },
    permission: {
      reply: async ({ requestID, reply, message }) => api('POST', `${at(asks.get(requestID)?.sessionID)}/permission/${requestID}/reply`,
        { body: { decision: reply, ...(message ? { message } : {}) } }),
    },
    question: {
      reply: async ({ requestID, answers }) => api('POST', `${at(asks.get(requestID)?.sessionID)}/form/${requestID}/reply`,
        { body: { answer: formAnswer(asks.get(requestID)?.fields || [], answers) } }),
      reject: async ({ requestID }) => api('DELETE', `${at(asks.get(requestID)?.sessionID)}/form/${requestID}`),
    },
    event: {
      async subscribe({ directory }, { signal } = {}) {
        const res = await fetch(baseUrl + '/api/event?' + new URLSearchParams({ 'location[directory]': directory }), { headers, signal });
        if (!res.ok) throw Error(`OpenCode events failed (${res.status})`);
        const translate = translator(asks);
        return { stream: (async function* () {
          const decoder = new TextDecoder();
          let buffer = '';
          for await (const chunk of res.body) {
            const lines = (buffer + decoder.decode(chunk, { stream: true })).split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
              yield* translate(event);
            }
          }
        })() };
      },
    },
    provider: {
      async list({ directory }, { signal } = {}) {
        let providers, models;
        // The catalog loads after the server starts listening: the first answers are empty.
        for (let i = 0; i < 20; i++) {
          [providers, models] = await Promise.all(['/api/provider', '/api/model'].map(r => api('GET', r, { directory, signal })));
          if (providers.data.length && models.data.length) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const all = providers.data.filter(p => p.activation !== 'disabled').map(p => ({ id: p.id, name: p.name,
          models: Object.fromEntries(models.data.filter(m => m.providerID === p.id && m.enabled !== false).map(m => [m.id, m])) }));
        return { data: { all, connected: all.map(p => p.id) } };
      },
    },
    app: { skills: ({ directory }, { signal } = {}) => api('GET', '/api/skill', { directory, signal }) },
  };
}

module.exports = { createClient, translator, formAnswer };

if (require.main === module) {
  const assert = require('assert');
  const t = translator();
  const run = (type, data) => t({ type, data: { sessionID: 's', ...data } });
  run('session.tool.input.started', { id: 'c', name: 'subagent' });
  assert.strictEqual(run('session.tool.called', { id: 'c', input: { agent: 'general' } })[0].properties.part.tool, 'task');
  assert.strictEqual(run('session.tool.progress', { id: 'c', metadata: { sessionID: 'kid' } })[0].properties.part.state.metadata.sessionId, 'kid');
  const done = run('session.tool.success', { id: 'c', content: [{ type: 'text', text: '<subagent sessionID="kid" state="completed">\npong\n</subagent>' }] });
  assert.strictEqual(done[0].properties.part.state.output, 'pong');
  assert.deepStrictEqual(run('session.execution.failed', { error: { message: 'no' } }).map(e => e.type), ['session.error', 'session.idle']);
  assert.deepStrictEqual(run('session.step.failed', { error: { type: 'aborted' } }), []);
  assert.deepStrictEqual(formAnswer([{ key: 'q0', type: 'string', options: [{ label: 'Tea', value: 't' }] }, { key: 'q1', type: 'multiselect' }], [['Tea'], ['a', 'b']]),
    { q0: 't', q1: ['a', 'b'] });
  console.log('opencode-v2: ok');
}
