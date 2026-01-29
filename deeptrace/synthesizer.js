const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const storage = require('./storage.js');

async function synthesize(researchContext, cancellationToken) {
  const synthesis = {
    topic: '',
    generatedAt: new Date().toISOString(),
    summary: '',
    sections: [],
    stats: {
      totalPages: 0,
      uniqueSources: 0,
      questionsAnswered: 0
    }
  };

  try {
    if (!researchContext || typeof researchContext !== 'object') {
      throw new Error('Invalid research context');
    }

    const topic = researchContext.topic || 'Unknown topic';
    synthesis.topic = topic;

    const runsDir = './runs';
    let runDirs = [];
    
    try {
      const files = await fs.readdir(runsDir);
      for (const file of files) {
        const fullPath = path.join(runsDir, file);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          runDirs.push(fullPath);
        }
      }
      runDirs.sort().reverse();
    } catch (error) {
      throw new Error(`Cannot access runs directory: ${error.message}`);
    }

    if (runDirs.length === 0) {
      throw new Error('No research runs found');
    }

    let currentRunPath = null;
    let metaData = null;
    let questions = [];
    const pageContent = new Map();

    for (const runDir of runDirs) {
      try {
        const metaPath = path.join(runDir, 'meta.json');
        const metaContent = await fs.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaContent);
        
        if (meta.topic === topic) {
          currentRunPath = runDir;
          metaData = meta;
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!currentRunPath) {
      throw new Error(`No run found for topic: ${topic}`);
    }

    const questionsPath = path.join(currentRunPath, 'questions.json');
    try {
      const questionsContent = await fs.readFile(questionsPath, 'utf8');
      questions = JSON.parse(questionsContent);
      if (!Array.isArray(questions)) {
        questions = [];
      }
    } catch (error) {
      questions = [];
    }

    const pagesPath = path.join(currentRunPath, 'pages.jsonl');
    const fileStream = await fs.open(pagesPath, 'r');
    const rl = readline.createInterface({
      input: fileStream.createReadStream(),
      crlfDelay: Infinity
    });

    let lineCount = 0;
    const sourceSet = new Set();
    
    for await (const line of rl) {
      if (cancellationToken && cancellationToken.cancelled) {
        break;
      }
      
      lineCount++;
      if (line.trim() === '') continue;
      
      try {
        const page = JSON.parse(line);
        if (!page || typeof page !== 'object') continue;
        
        const url = page.url;
        const extractedText = page.extractedText || '';
        const questionId = page.questionId || '';
        
        if (!url || extractedText.length < 100) continue;
        
        sourceSet.add(url);
        
        if (questionId) {
          if (!pageContent.has(questionId)) {
            pageContent.set(questionId, {
              texts: [],
              sources: new Set()
            });
          }
          const entry = pageContent.get(questionId);
          
          const isDuplicate = entry.texts.some(existing => 
            existing.length > 0 && 
            (extractedText.includes(existing.substring(0, 100)) || 
             existing.includes(extractedText.substring(0, 100)))
          );
          
          if (!isDuplicate) {
            entry.texts.push(extractedText.substring(0, 5000));
            entry.sources.add(url);
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    await fileStream.close();

    synthesis.stats.totalPages = lineCount;
    synthesis.stats.uniqueSources = sourceSet.size;

    const questionMap = new Map();
    const rootQuestions = [];
    
    for (const question of questions) {
      if (!question || typeof question !== 'object') continue;
      
      const safeQuestion = {
        id: question.id || `q${questionMap.size + 1}`,
        question: question.question || '',
        depth: typeof question.depth === 'number' ? question.depth : 0,
        intent: question.intent || 'analysis',
        priority: question.priority || 'secondary',
        subQuestions: Array.isArray(question.subQuestions) ? question.subQuestions : []
      };
      
      questionMap.set(safeQuestion.id, safeQuestion);
      
      if (safeQuestion.depth === 0) {
        rootQuestions.push(safeQuestion);
      }
    }

    let questionsAnswered = 0;
    
    for (const rootQuestion of rootQuestions) {
      const section = {
        questionId: rootQuestion.id,
        question: rootQuestion.question,
        summary: '',
        sources: [],
        subSections: []
      };

      const rootContent = pageContent.get(rootQuestion.id);
      if (rootContent && rootContent.texts.length > 0) {
        questionsAnswered++;
        const combinedText = rootContent.texts.join(' ').substring(0, 8000);
        section.summary = generateSummary(combinedText, rootQuestion.question, rootQuestion.intent);
        section.sources = Array.from(rootContent.sources).slice(0, 10);
      } else {
        section.summary = 'Insufficient data collected for this question.';
      }

      for (const subQuestion of rootQuestion.subQuestions) {
        if (!subQuestion || typeof subQuestion !== 'object') continue;
        
        const subSection = {
          questionId: subQuestion.id || `${rootQuestion.id}_sub`,
          question: subQuestion.question || '',
          summary: '',
          sources: []
        };

        const subContent = pageContent.get(subQuestion.id);
        if (subContent && subContent.texts.length > 0) {
          const combinedSubText = subContent.texts.join(' ').substring(0, 4000);
          subSection.summary = generateSummary(combinedSubText, subQuestion.question, subQuestion.intent);
          subSection.sources = Array.from(subContent.sources).slice(0, 5);
        } else {
          subSection.summary = 'Insufficient data collected for this sub-question.';
        }
        
        section.subSections.push(subSection);
      }
      
      synthesis.sections.push(section);
    }

    synthesis.stats.questionsAnswered = questionsAnswered;
    
    const allSummaries = synthesis.sections
      .map(s => s.summary)
      .filter(s => s && !s.includes('Insufficient data'))
      .join(' ');
    
    synthesis.summary = generateOverallSummary(allSummaries, topic, synthesis.stats);

    await storage.saveSynthesis(synthesis);
    
    return synthesis;
    
  } catch (error) {
    const errorSynthesis = {
      ...synthesis,
      summary: `Synthesis failed: ${error.message}`,
      error: error.message,
      generatedAt: new Date().toISOString()
    };
    
    try {
      await storage.saveSynthesis(errorSynthesis);
    } catch (saveError) {
    }
    
    return errorSynthesis;
  }
}

function generateSummary(text, question, intent) {
  if (!text || text.length < 50) {
    return 'No substantive content available for analysis.';
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length === 0) {
    return text.substring(0, 300).trim();
  }

  const relevantSentences = sentences.filter(sentence => {
    const lowerSentence = sentence.toLowerCase();
    const lowerQuestion = question.toLowerCase();
    const questionWords = lowerQuestion.split(/\s+/).filter(w => w.length > 3);
    
    return questionWords.some(word => lowerSentence.includes(word));
  });

  let content = relevantSentences.length > 0 
    ? relevantSentences.slice(0, 5).join(' ')
    : sentences.slice(0, 3).join(' ');

  content = content
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1500);

  if (content.length < 100) {
    content = sentences.slice(0, 2).join(' ').substring(0, 500);
  }

  return content;
}

function generateOverallSummary(summaries, topic, stats) {
  if (!summaries || summaries.trim().length < 100) {
    return `Research on "${topic}" collected ${stats.totalPages} pages from ${stats.uniqueSources} sources. Insufficient content for comprehensive synthesis.`;
  }

  const sentences = summaries.match(/[^.!?]+[.!?]+/g) || [];
  const keySentences = sentences.slice(0, 8).join(' ');
  
  return `Research on "${topic}" analyzed ${stats.totalPages} pages from ${stats.uniqueSources} sources, addressing ${stats.questionsAnswered} questions. Key findings: ${keySentences}`.substring(0, 2000);
}

module.exports = {
  synthesize
};
