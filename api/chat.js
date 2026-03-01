// api/chat.js — Vercel Serverless Function
// Proxies chat requests to OpenRouter with model routing
// API key never exposed to the browser

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const MODELS = {
  simple:  'meta-llama/llama-3.2-3b-instruct:free',
  medium:  'mistralai/mistral-7b-instruct:free',
  complex: 'anthropic/claude-3-haiku-20240307'
};

const SYSTEM_PROMPT = `You are Emily, a friendly and professional AI assistant for Valure — an AI automation agency that helps home service contractors (plumbers, electricians, HVAC technicians) eliminate repetitive work through custom AI automation.

Your personality: Warm, confident, knowledgeable, concise. You speak in plain business language — no jargon. You use light emoji to keep things approachable but stay professional.

Key facts about Valure:
- We build custom AI automation systems — not off-the-shelf tools or templates
- Core services: missed call text-back, appointment confirmations, review requests, lead follow-up sequences, AI workflow automation, AI agents, custom integrations, data & reporting automation
- Pricing: Project builds from $8,000. Managed retainers from $3,500/month. Free audit always included
- Timeline: First automation live within 14 days of kickoff. Simple workflows in 7 days
- Target clients: Home service contractors doing $500K–$50M revenue
- Free automation audit: 30-minute call, zero pressure, zero cost
- No contracts — cancel anytime
- Data is encrypted, secure, GDPR-compliant, never shared
- Response time: Within 2 business hours Mon–Fri

Your goals:
1. Answer questions about Valure clearly and honestly
2. Identify the visitor's pain points
3. Guide them toward booking a free audit
4. Never make up pricing or promises not listed above
5. For anything outside your knowledge, direct them to the contact form

When guiding to the contact form say: "Scroll down to our contact form — we respond within 2 business hours and the audit is completely free."

Keep responses concise — 2-4 sentences max unless the question genuinely requires more detail.`;

// Detect complexity of the user message
function detectComplexity(message, history) {
  const text       = message.toLowerCase().trim();
  const wordCount  = message.split(' ').length;
  const historyLen = history.length;

  // Simple — short messages, greetings, single word questions
  const simplePatterns = [
    'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay',
    'yes', 'no', 'sure', 'great', 'awesome', 'cool', 'got it'
  ];

  const isGreeting = simplePatterns.some(p => text === p || text.startsWith(p + ' '));
  if (isGreeting || wordCount <= 4) return 'simple';

  // Complex — long messages, multiple questions, technical depth
  const complexPatterns = [
    'integrate', 'api', 'technical', 'architecture', 'how exactly',
    'explain in detail', 'step by step', 'compare', 'difference between',
    'custom', 'specific', 'enterprise', 'compliance', 'gdpr', 'soc',
    'multiple', 'several', 'and also', 'also want', 'in addition'
  ];

  const isComplex = complexPatterns.some(p => text.includes(p)) || wordCount > 25;
  if (isComplex || historyLen > 8) return 'complex';

  // Everything else is medium
  return 'medium';
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic auth check
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  // Sanitize — limit message length
  const sanitized = message.slice(0, 500);

  // Detect complexity and pick model
  const complexity = detectComplexity(sanitized, history);
  const model      = MODELS[complexity];

  // Build message history for context
  const chatHistory = history.slice(-6).map(m => ({
    role:    m.sender === 'user' ? 'user' : 'assistant',
    content: m.text
  }));

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type':   'application/json',
        'HTTP-Referer':   'https://valure.io',
        'X-Title':        'Valure AI Assistant'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...chatHistory,
          { role: 'user', content: sanitized }
        ],
        max_tokens:  300,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      throw new Error('OpenRouter request failed');
    }

    const data    = await response.json();
    const reply   = data.choices?.[0]?.message?.content;

    if (!reply) throw new Error('No response from model');

    return res.status(200).json({
      reply,
      model,
      complexity
    });

  } catch (err) {
    console.error('Chat handler error:', err.message);
    return res.status(500).json({
      error: 'Something went wrong. Please try again.'
    });
  }
}
