const MAX_DEPTH = 2;
const MAX_SUBQUESTIONS = 3;
const REFINER_VERSION = '1.0';

const NARROWING_PATTERNS = {
  definition: [
    'What specific examples illustrate {topic}?',
    'How is {topic} measured or evaluated?',
    'What are the key variations or types of {topic}?'
  ],
  analysis: [
    'What evidence supports the mechanisms of {topic}?',
    'How do different components of {topic} interact?',
    'What data demonstrates how {topic} functions?'
  ],
  comparison: [
    'What specific criteria distinguish {topic} from alternatives?',
    'In what scenarios does {topic} outperform competitors?',
    'What quantitative comparisons exist for {topic}?'
  ],
  impact: [
    'What case studies document the impact of {topic}?',
    'How is the impact of {topic} quantified?',
    'What long-term effects has {topic} produced?'
  ],
  risk: [
    'What documented incidents relate to {topic}?',
    'How are risks of {topic} mitigated in practice?',
    'What failure modes have been observed with {topic}?'
  ],
  implementation: [
    'What tools or frameworks support {topic}?',
    'What prerequisites must be met for {topic}?',
    'What common pitfalls occur when implementing {topic}?'
  ],
  trend: [
    'What recent research advances {topic}?',
    'What organizations are leading development in {topic}?',
    'What timelines exist for {topic} evolution?'
  ],
  limitation: [
    'What specific use cases are unsuitable for {topic}?',
    'What performance boundaries limit {topic}?',
    'What alternatives address the limitations of {topic}?'
  ]
};

const FALLBACK_PATTERNS = [
  'What evidence exists regarding {topic}?',
  'What practical applications demonstrate {topic}?',
  'What specific details clarify {topic}?'
];

const VALID_INTENTS = new Set([
  'definition', 'analysis', 'comparison', 'impact', 'risk',
  'implementation', 'trend', 'limitation'
]);

function refineQuestionTree(initialQuestions, researchContext, cancellationToken) {
  try {
    if (!initialQuestions || !Array.isArray(initialQuestions)) {
      return [];
    }

    if (cancellationToken && cancellationToken.cancelled) {
      return initialQuestions.map(q => ({ ...normalizeParentQuestion(q), subQuestions: [] }));
    }

    const safeResearchContext = normalizeResearchContext(researchContext);
    const refinedTree = [];

    for (const question of initialQuestions) {
      if (cancellationToken && cancellationToken.cancelled) {
        const safeParent = normalizeParentQuestion(question);
        refinedTree.push({ ...safeParent, subQuestions: [] });
        continue;
      }

      const safeParent = normalizeParentQuestion(question);
      const seenNormalized = new Set();
      const rootNormalized = normalizeQuestion(safeParent.question);
      seenNormalized.add(rootNormalized);

      const subQuestions = generateSubQuestions(
        safeParent,
        safeResearchContext,
        seenNormalized,
        cancellationToken
      );

      refinedTree.push({
        ...safeParent,
        subQuestions: subQuestions
      });
    }

    return refinedTree;
  } catch (error) {
    return (initialQuestions || []).map(q => ({
      ...normalizeParentQuestion(q),
      subQuestions: [],
      source: 'refiner-fallback'
    }));
  }
}

function normalizeResearchContext(researchContext) {
  const safeContext = {
    topic: 'this topic',
    runId: null,
    startTime: null,
    maxPages: 200
  };

  if (researchContext && typeof researchContext === 'object') {
    if (typeof researchContext.topic === 'string' && researchContext.topic.trim().length > 0) {
      safeContext.topic = researchContext.topic.trim();
    }
    if (researchContext.runId !== undefined) safeContext.runId = researchContext.runId;
    if (researchContext.startTime !== undefined) safeContext.startTime = researchContext.startTime;
    if (researchContext.maxPages !== undefined) safeContext.maxPages = researchContext.maxPages;
  }

  return safeContext;
}

function normalizeParentQuestion(parentQuestion) {
  const safeQuestion = {
    id: 'unknown',
    question: '',
    depth: 0,
    intent: 'analysis',
    priority: 'secondary',
    cost: 'medium',
    searchHints: [],
    source: parentQuestion && parentQuestion.source ? parentQuestion.source : 'unknown'
  };

  if (!parentQuestion || typeof parentQuestion !== 'object') {
    return safeQuestion;
  }

  if (typeof parentQuestion.id === 'string' && parentQuestion.id.trim().length > 0) {
    safeQuestion.id = parentQuestion.id.trim();
  }

  if (typeof parentQuestion.question === 'string' && parentQuestion.question.trim().length > 0) {
    safeQuestion.question = parentQuestion.question.trim();
  }

  if (typeof parentQuestion.depth === 'number' && parentQuestion.depth >= 0) {
    safeQuestion.depth = Math.min(parentQuestion.depth, MAX_DEPTH);
  }

  if (typeof parentQuestion.intent === 'string' && VALID_INTENTS.has(parentQuestion.intent)) {
    safeQuestion.intent = parentQuestion.intent;
  }

  if (typeof parentQuestion.priority === 'string' && 
      (parentQuestion.priority === 'core' || parentQuestion.priority === 'secondary')) {
    safeQuestion.priority = parentQuestion.priority;
  }

  if (typeof parentQuestion.cost === 'string' && 
      ['low', 'medium', 'high'].includes(parentQuestion.cost)) {
    safeQuestion.cost = parentQuestion.cost;
  }

  if (Array.isArray(parentQuestion.searchHints)) {
    safeQuestion.searchHints = parentQuestion.searchHints.filter(hint => 
      typeof hint === 'string' && hint.trim().length > 0
    );
  }

  return safeQuestion;
}

function generateSubQuestions(parentQuestion, researchContext, seenNormalized, cancellationToken) {
  try {
    if (parentQuestion.depth >= MAX_DEPTH) {
      return [];
    }

    if (cancellationToken && cancellationToken.cancelled) {
      return [];
    }

    const safeIntent = VALID_INTENTS.has(parentQuestion.intent) ? parentQuestion.intent : 'analysis';
    const patterns = NARROWING_PATTERNS[safeIntent] || FALLBACK_PATTERNS;
    
    const topicExtract = extractTopicFromQuestion(parentQuestion.question, researchContext.topic);
    const seed = researchContext.topic + parentQuestion.id;
    
    const subQuestions = [];
    const maxToGenerate = Math.min(MAX_SUBQUESTIONS, patterns.length);
    const usedPatternIndices = new Set();
    
    for (let i = 0; i < maxToGenerate; i++) {
      if (cancellationToken && cancellationToken.cancelled) {
        break;
      }

      let patternIndex;
      let attempts = 0;
      const maxAttempts = patterns.length * 2;
      
      do {
        patternIndex = deterministicIndex(seed + i + attempts, patterns.length);
        attempts++;
        if (attempts > maxAttempts) {
          patternIndex = -1;
          break;
        }
      } while (usedPatternIndices.has(patternIndex));
      
      if (patternIndex === -1) {
        break;
      }
      
      usedPatternIndices.add(patternIndex);
      const pattern = patterns[patternIndex];
      const questionText = pattern.replace(/{topic}/g, topicExtract);

      const normalized = normalizeQuestion(questionText);
      if (seenNormalized.has(normalized)) {
        continue;
      }

      if (!isValidSubQuestion(questionText, parentQuestion.question)) {
        continue;
      }

      seenNormalized.add(normalized);

      const uniqueSuffix = deterministicHash(seed + patternIndex + REFINER_VERSION).toString(36).slice(0, 4);
      const subId = `${parentQuestion.id}_s${i + 1}_${uniqueSuffix}`;
      const subPriority = determineSubPriority(parentQuestion, i);
      const subCost = determineSubCost(parentQuestion.cost);
      const subHints = generateSubHints(parentQuestion.searchHints, safeIntent, i);

      subQuestions.push({
        id: subId,
        question: questionText,
        depth: parentQuestion.depth + 1,
        intent: safeIntent,
        priority: subPriority,
        cost: subCost,
        searchHints: subHints,
        source: 'refined',
        parentId: parentQuestion.id,
        refinerVersion: REFINER_VERSION
      });
    }

    return subQuestions;
  } catch (error) {
    return [];
  }
}

function extractTopicFromQuestion(questionText, fallbackTopic) {
  const patterns = [
    /(?:what|how|why|when|where)\s+(?:is|are|does|do|can|has|have)\s+(.+?)\s+(?:and|or|\?)/i,
    /(?:what|how)\s+(.+?)\s+(?:work|function|operate)/i,
    /(.+?)\s+(?:compare|differ|relate)/i
  ];

  for (const pattern of patterns) {
    const match = questionText.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (extracted.length >= 3 && extracted.length <= 100) {
        return extracted;
      }
    }
  }

  return fallbackTopic || 'this topic';
}

function isValidSubQuestion(subQuestion, parentQuestion) {
  if (subQuestion.length < 15) {
    return false;
  }

  const subLower = subQuestion.toLowerCase();
  const parentLower = parentQuestion.toLowerCase();

  const subWords = new Set(subLower.split(/\s+/).filter(w => w.length > 3));
  const parentWords = new Set(parentLower.split(/\s+/).filter(w => w.length > 3));

  let commonWords = 0;
  for (const word of subWords) {
    if (parentWords.has(word)) {
      commonWords++;
    }
  }

  const overlap = commonWords / Math.max(subWords.size, 1);
  if (overlap > 0.8) {
    return false;
  }

  const meaningfulWords = subLower.split(/\s+/).filter(w => w.length > 2);
  if (meaningfulWords.length < 4) {
    return false;
  }

  return true;
}

function determineSubPriority(parentQuestion, index) {
  if (parentQuestion.priority === 'core') {
    return index === 0 ? 'core' : 'secondary';
  }
  return 'secondary';
}

function determineSubCost(parentCost) {
  const costMap = {
    'high': 'medium',
    'medium': 'low',
    'low': 'low'
  };
  return costMap[parentCost] || 'low';
}

function generateSubHints(parentHints, intent, index) {
  const baseHints = Array.isArray(parentHints) ? [...parentHints] : [];
  
  const intentHints = {
    definition: ['examples', 'types', 'measurement'],
    analysis: ['evidence', 'data', 'mechanisms'],
    comparison: ['criteria', 'scenarios', 'quantitative'],
    impact: ['case studies', 'quantified', 'long-term'],
    risk: ['incidents', 'mitigation', 'failure modes'],
    implementation: ['tools', 'prerequisites', 'pitfalls'],
    trend: ['research', 'organizations', 'timeline'],
    limitation: ['unsuitable', 'boundaries', 'alternatives']
  };

  const extras = intentHints[intent] || ['details', 'specific', 'practical'];
  if (index < extras.length) {
    baseHints.push(extras[index]);
  }

  return baseHints.slice(0, 4);
}

function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

module.exports = {
  refineQuestionTree
};
