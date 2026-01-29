/**
 * questioner.js
 * Generates initial research questions from a topic and optional instruction.
 * First step in the autonomous research pipeline.
 */

const MAX_INITIAL_QUESTIONS = 8;
const GENERATOR_VERSION = '1.0';

const VALID_INTENTS = [
  'definition',
  'analysis',
  'comparison',
  'impact',
  'risk',
  'implementation',
  'trend',
  'limitation'
];

const QUESTION_TEMPLATES = {
  definition: [
    { text: 'What is {topic} and what are its core characteristics?', cost: 'medium', hints: ['definition', 'overview', 'basics'] },
    { text: 'How is {topic} formally defined in its field?', cost: 'medium', hints: ['definition', 'formal', 'specification'] },
    { text: 'What are the fundamental principles underlying {topic}?', cost: 'high', hints: ['principles', 'fundamentals', 'theory'] },
    { text: 'What components or elements constitute {topic}?', cost: 'medium', hints: ['components', 'architecture', 'structure'] }
  ],
  analysis: [
    { text: 'How does {topic} work at a technical or operational level?', cost: 'high', hints: ['how it works', 'mechanisms', 'process'] },
    { text: 'What mechanisms drive the effectiveness of {topic}?', cost: 'high', hints: ['mechanisms', 'effectiveness', 'analysis'] },
    { text: 'What factors most significantly influence {topic}?', cost: 'medium', hints: ['factors', 'influence', 'variables'] },
    { text: 'How does {topic} behave under different conditions?', cost: 'medium', hints: ['behavior', 'conditions', 'scenarios'] }
  ],
  comparison: [
    { text: 'How does {topic} compare to alternative approaches?', cost: 'medium', hints: ['comparison', 'alternatives', 'versus'] },
    { text: 'What distinguishes {topic} from competing methods or technologies?', cost: 'medium', hints: ['differences', 'competitive', 'unique'] },
    { text: 'What are the relative advantages and disadvantages of {topic}?', cost: 'medium', hints: ['pros cons', 'advantages', 'disadvantages'] },
    { text: 'How does {topic} perform against industry benchmarks?', cost: 'low', hints: ['benchmarks', 'performance', 'standards'] }
  ],
  impact: [
    { text: 'What measurable impact has {topic} had on its industry?', cost: 'medium', hints: ['impact', 'industry', 'effects'] },
    { text: 'How has {topic} changed existing practices or outcomes?', cost: 'medium', hints: ['changes', 'transformation', 'outcomes'] },
    { text: 'What real-world consequences have resulted from {topic}?', cost: 'medium', hints: ['consequences', 'real-world', 'results'] },
    { text: 'What economic or social effects does {topic} produce?', cost: 'low', hints: ['economic', 'social', 'effects'] }
  ],
  risk: [
    { text: 'What risks or challenges are associated with {topic}?', cost: 'medium', hints: ['risks', 'challenges', 'problems'] },
    { text: 'What failures or problems have been documented with {topic}?', cost: 'medium', hints: ['failures', 'issues', 'problems'] },
    { text: 'What security or safety concerns does {topic} raise?', cost: 'medium', hints: ['security', 'safety', 'concerns'] },
    { text: 'What unintended consequences can arise from {topic}?', cost: 'low', hints: ['unintended', 'side effects', 'consequences'] }
  ],
  implementation: [
    { text: 'How is {topic} implemented in real-world applications?', cost: 'medium', hints: ['implementation', 'real-world', 'applications'] },
    { text: 'What requirements exist for successfully deploying {topic}?', cost: 'medium', hints: ['requirements', 'deployment', 'prerequisites'] },
    { text: 'What best practices govern the application of {topic}?', cost: 'low', hints: ['best practices', 'guidelines', 'standards'] },
    { text: 'What steps are necessary to operationalize {topic}?', cost: 'medium', hints: ['steps', 'process', 'operationalize'] }
  ],
  trend: [
    { text: 'What are the emerging developments in {topic}?', cost: 'low', hints: ['emerging', 'developments', 'new'] },
    { text: 'How has {topic} evolved over time and where is it headed?', cost: 'medium', hints: ['evolution', 'history', 'future'] },
    { text: 'What innovations are shaping the future of {topic}?', cost: 'low', hints: ['innovations', 'future', 'trends'] },
    { text: 'What trends are influencing the direction of {topic}?', cost: 'low', hints: ['trends', 'direction', 'influence'] }
  ],
  limitation: [
    { text: 'What are the known limitations of {topic}?', cost: 'medium', hints: ['limitations', 'constraints', 'boundaries'] },
    { text: 'Where does {topic} fail to meet expectations?', cost: 'medium', hints: ['failures', 'shortcomings', 'gaps'] },
    { text: 'What problems cannot be solved by {topic}?', cost: 'medium', hints: ['unsolved', 'limitations', 'cannot solve'] },
    { text: 'What constraints restrict the effectiveness of {topic}?', cost: 'low', hints: ['constraints', 'restrictions', 'limits'] }
  ]
};

const FALLBACK_QUESTIONS = [
  { intent: 'definition', text: 'What is {topic} and how does it work?', cost: 'medium', hints: ['definition', 'overview', 'basics'] },
  { intent: 'analysis', text: 'What are the key components of {topic}?', cost: 'medium', hints: ['components', 'structure', 'parts'] },
  { intent: 'impact', text: 'What impact does {topic} have in practice?', cost: 'medium', hints: ['impact', 'effects', 'practical'] },
  { intent: 'risk', text: 'What challenges are associated with {topic}?', cost: 'medium', hints: ['challenges', 'risks', 'issues'] },
  { intent: 'implementation', text: 'How is {topic} implemented in real scenarios?', cost: 'medium', hints: ['implementation', 'real-world', 'usage'] }
];

function generateInitialQuestions(topic, extraInstruction = null) {
  try {
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return generateFallbackQuestions('research topic');
    }

    const cleanTopic = topic.trim();
    if (cleanTopic.length < 3) {
      return generateFallbackQuestions(cleanTopic);
    }

    const sanitizedInstruction = sanitizeExtraInstruction(extraInstruction);
    const seed = cleanTopic + (sanitizedInstruction || '');
    const intentPlan = buildIntentPlan(sanitizedInstruction, seed);
    const questions = [];
    const seenNormalized = new Set();
    let questionId = 1;

    for (const intent of intentPlan) {
      if (questions.length >= MAX_INITIAL_QUESTIONS) {
        break;
      }

      const templates = QUESTION_TEMPLATES[intent];
      const templateIndex = deterministicIndex(seed + intent, templates.length);
      const template = templates[templateIndex];
      const questionText = template.text.replace(/{topic}/g, cleanTopic);

      if (!isValidQuestion(questionText, cleanTopic)) {
        continue;
      }

      const finalQuestion = applyExtraInstruction(questionText, sanitizedInstruction);
      const normalized = normalizeQuestion(finalQuestion);

      if (!seenNormalized.has(normalized)) {
        seenNormalized.add(normalized);
        
        const priority = questions.length < 4 ? 'core' : 'secondary';
        const searchHints = generateSearchHints(cleanTopic, template.hints, sanitizedInstruction);

        questions.push({
          id: `q${questionId}`,
          question: finalQuestion,
          depth: 0,
          intent: intent,
          priority: priority,
          cost: template.cost,
          searchHints: searchHints,
          source: 'generated',
          generatorVersion: GENERATOR_VERSION
        });
        
        questionId++;
      }
    }

    if (questions.length < 5) {
      return generateFallbackQuestions(cleanTopic);
    }

    enforceIntentCoverage(questions, cleanTopic, seed);

    return questions.slice(0, MAX_INITIAL_QUESTIONS);
  } catch (error) {
    return generateFallbackQuestions(topic || 'research topic');
  }
}

function generateFallbackQuestions(topic) {
  const cleanTopic = (topic || 'research topic').trim();
  return FALLBACK_QUESTIONS.map((item, index) => ({
    id: `q${index + 1}`,
    question: item.text.replace(/{topic}/g, cleanTopic),
    depth: 0,
    intent: item.intent,
    priority: index < 4 ? 'core' : 'secondary',
    cost: item.cost,
    searchHints: item.hints,
    source: 'generated',
    generatorVersion: GENERATOR_VERSION
  }));
}

function sanitizeExtraInstruction(instruction) {
  if (!instruction || typeof instruction !== 'string') {
    return null;
  }

  let cleaned = instruction.trim();
  if (cleaned.length === 0 || cleaned.length > 200) {
    return null;
  }

  cleaned = cleaned
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/[`'"]/g, '')
    .replace(/[{}[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 3) {
    return null;
  }

  const words = cleaned.split(/\s+/);
  return words.slice(0, 12).join(' ');
}

function buildIntentPlan(extraInstruction, seed) {
  const required = ['definition', 'analysis'];
  
  const impactOrRisk = deterministicChoice(seed + 'impactRisk', ['impact', 'risk']);
  required.push(impactOrRisk);
  
  const implOrComp = deterministicChoice(seed + 'implComp', ['implementation', 'comparison']);
  required.push(implOrComp);

  const remaining = VALID_INTENTS.filter(intent => !required.includes(intent));

  let prioritized = [];
  let unprioritized = [];

  if (extraInstruction) {
    const instruction = extraInstruction.toLowerCase();
    
    for (const intent of remaining) {
      if (shouldPrioritizeIntent(intent, instruction)) {
        prioritized.push(intent);
      } else {
        unprioritized.push(intent);
      }
    }
  } else {
    unprioritized = [...remaining];
  }

  const shuffledPrioritized = deterministicShuffle(prioritized, seed + 'prioritized');
  const shuffledUnprioritized = deterministicShuffle(unprioritized, seed + 'unprioritized');

  return [
    ...required,
    ...shuffledPrioritized,
    ...shuffledUnprioritized
  ];
}

function shouldPrioritizeIntent(intent, instruction) {
  const intentKeywords = {
    comparison: ['compare', 'versus', 'vs', 'alternative', 'difference'],
    implementation: ['implement', 'deploy', 'use', 'apply', 'practice', 'build'],
    trend: ['future', 'trend', 'emerging', 'development', 'innovation'],
    limitation: ['limitation', 'constraint', 'weakness', 'drawback']
  };

  const keywords = intentKeywords[intent] || [];
  return keywords.some(keyword => instruction.includes(keyword));
}

function isValidQuestion(question, topic) {
  const withoutTopic = question.replace(new RegExp(topic, 'gi'), '').trim();
  const meaningfulWords = withoutTopic.split(/\s+/).filter(word => word.length > 2);
  
  if (meaningfulWords.length < 5) {
    return false;
  }

  if (question.length < 20) {
    return false;
  }

  if (question.toLowerCase().startsWith('is ') || 
      question.toLowerCase().startsWith('does ') ||
      question.toLowerCase().startsWith('can ') ||
      question.toLowerCase().startsWith('will ')) {
    const hasOr = question.includes(' or ');
    if (!hasOr) {
      return false;
    }
  }

  return true;
}

function applyExtraInstruction(question, sanitizedInstruction) {
  if (!sanitizedInstruction) {
    return question;
  }

  const focusArea = extractFocusArea(sanitizedInstruction);
  if (!focusArea) {
    return question;
  }

  if (focusArea.length < 3) {
    return question;
  }

  return question.replace('?', ` with emphasis on ${focusArea}?`);
}

function extractFocusArea(instruction) {
  const patterns = [
    /focus on (.+?)(?:\.|$)/i,
    /emphasize (.+?)(?:\.|$)/i,
    /specifically (.+?)(?:\.|$)/i,
    /regarding (.+?)(?:\.|$)/i,
    /about (.+?)(?:\.|$)/i
  ];

  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (match && match[1]) {
      const area = match[1].trim();
      if (area.length >= 3 && area.length <= 100) {
        return area;
      }
    }
  }

  const words = instruction.split(/\s+/);
  if (words.length >= 2 && words.length <= 12) {
    return instruction;
  }

  return null;
}

function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateSearchHints(topic, baseHints, extraInstruction) {
  const hints = [...baseHints];
  
  if (extraInstruction) {
    const words = extraInstruction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      hints.push(words[0]);
    }
  }

  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (topicWords.length > 0 && !hints.includes(topicWords[0])) {
    hints.unshift(topicWords[0]);
  }

  return hints.slice(0, 4);
}

function enforceIntentCoverage(questions, topic, seed) {
  const presentIntents = new Set(questions.map(q => q.intent));
  
  const requiredCoverage = {
    'definition': true,
    'analysis': true,
    'impactOrRisk': !presentIntents.has('impact') && !presentIntents.has('risk'),
    'implOrComp': !presentIntents.has('implementation') && !presentIntents.has('comparison')
  };

  if (!presentIntents.has('definition')) {
    forceAddIntent('definition', questions, topic, seed);
  }

  if (!presentIntents.has('analysis')) {
    forceAddIntent('analysis', questions, topic, seed);
  }

  if (requiredCoverage.impactOrRisk) {
    const intent = deterministicChoice(seed + 'forceImpactRisk', ['impact', 'risk']);
    forceAddIntent(intent, questions, topic, seed);
  }

  if (requiredCoverage.implOrComp) {
    const intent = deterministicChoice(seed + 'forceImplComp', ['implementation', 'comparison']);
    forceAddIntent(intent, questions, topic, seed);
  }
}

function forceAddIntent(intent, questions, topic, seed) {
  const templates = QUESTION_TEMPLATES[intent];
  const templateIndex = deterministicIndex(seed + intent + 'force', templates.length);
  const template = templates[templateIndex];
  const questionText = template.text.replace(/{topic}/g, topic);

  const nextId = questions.length + 1;
  const priority = questions.length < 4 ? 'core' : 'secondary';

  questions.push({
    id: `q${nextId}`,
    question: questionText,
    depth: 0,
    intent: intent,
    priority: priority,
    cost: template.cost,
    searchHints: template.hints.slice(0, 4),
    source: 'generated',
    generatorVersion: GENERATOR_VERSION
  });
}

function deterministicHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function deterministicIndex(seed, length) {
  if (length === 0) return 0;
  return deterministicHash(seed) % length;
}

function deterministicChoice(seed, options) {
  if (options.length === 0) return null;
  const index = deterministicIndex(seed, options.length);
  return options[index];
}

function deterministicShuffle(array, seed) {
  if (array.length === 0) {
    return [];
  }

  const result = [...array];
  let hash = deterministicHash(seed);

  for (let i = result.length - 1; i > 0; i--) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    const j = hash % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

module.exports = {
  generateInitialQuestions
};
