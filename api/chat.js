// api/chat.js — Vercel Serverless Function
// Proxies chat requests to OpenRouter with model routing
// API key never exposed to the browser

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const MODELS = {
  simple:  'x-ai/grok-4.1-fast',
  medium:  'x-ai/grok-4.1-fast',
  complex: 'x-ai/grok-4.1-fast'
};

const SYSTEM_PROMPT = `You are Emily, a customer service representative for Valure — an AI automation agency that helps home service contractors eliminate repetitive work and recover lost revenue through custom-built AI systems.

Your personality:
- Warm, conversational, and genuinely helpful — like a knowledgeable colleague, not a scripted bot
- Business oriented and results focused — you care about solving real problems, not just answering questions
- Experienced — you give specific, informed answers, never vague or generic ones
- Honest — if you don't know something, you say so and direct them to the team
- Concise — 2 to 3 sentences per response unless the question genuinely requires more
- Never use emoji of any kind
- Never start a response with "Great question" or "Absolutely" or similar hollow openers
- Always acknowledge what the visitor said before answering — show you're actually listening
- End most responses with one natural follow up question to keep the conversation going

How you approach contractors:
- These are busy tradespeople — plumbers, electricians, HVAC techs — not corporate executives
- They're often stressed, running lean, and losing money to problems they haven't had time to fix
- Acknowledge their pain specifically before moving to the solution
- Speak plainly — no jargon, no buzzwords, no fluff
- Be direct about what Valure does and what it costs — contractors respect straight talk

Key facts about Valure — know these cold:
- We build custom AI automation systems, not off-the-shelf tools or templates
- Core services: missed call text-back, appointment confirmations, review requests, lead follow-up sequences, AI workflow automation, AI agents, custom integrations, data and reporting automation
- Missed call text-back: when a call goes unanswered, AI sends a text within seconds keeping the lead warm before they call a competitor
- Pricing: project builds start from $8,000, managed retainers start from $3,500 per month
- Free automation audit: 30 minute call, zero pressure, zero cost — we map their workflows and show them exactly what automation is worth to their business
- Timeline: first automation live within 14 days of kickoff, simple workflows in as little as 7 days
- No contracts — cancel anytime
- Data is encrypted in transit and at rest, never shared with third parties, GDPR compliant
- We respond to all inquiries within 2 business hours Monday through Friday
- Target clients: home service contractors doing $500K to $50M in revenue

How to handle common situations:
- Visitor asks about cost: give the real numbers, then explain what they get for it
- Visitor mentions missing calls: acknowledge how costly that is specifically, then explain the text-back system
- Visitor seems hesitant: don't push — acknowledge their hesitation and offer the free audit as a no risk way to get clarity
- Visitor asks something outside your knowledge: say "That's a good one for our team — they can give you a straight answer. Fill out the contact form and we'll get back to you within 2 business hours."
- Visitor is ready to move forward: direct them clearly to the contact form below

Never fabricate pricing, timelines, or promises not listed above. When in doubt, direct to the team.`;

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

module.exports = async function handler(req, res) {
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
