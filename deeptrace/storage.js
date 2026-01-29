const fs = require('fs').promises;
const path = require('path');

const BASE_DIR = './runs';

let currentRunPath = null;
let metaData = null;
let isFlushing = false;
let shutdownRequested = false;
let writeQueue = [];
let processingQueue = false;

const atomicWrite = async (filePath, data) => {
  if (shutdownRequested) return false;
  
  const tmpPath = filePath + '.tmp';
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, jsonStr, 'utf8');
    await fs.fsync(await fs.open(tmpPath, 'r+'));
    
    await fs.rename(tmpPath, filePath);
    
    try {
      const fd = await fs.open(filePath, 'r+');
      await fd.sync();
      await fd.close();
    } catch (syncError) {
    }
    
    return true;
  } catch (error) {
    try {
      await fs.unlink(tmpPath).catch(() => {});
    } catch (unlinkError) {
    }
    console.warn(`Atomic write failed for ${filePath}:`, error.message);
    return false;
  }
};

const sanitizeFilename = (str) => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'research';
};

const getRunDirectoryName = (topic) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) + 'Z';
  const sanitizedTopic = sanitizeFilename(topic);
  return `${sanitizedTopic}_${timestamp}`;
};

async function initialize(researchContext) {
  if (currentRunPath) {
    return;
  }

  try {
    await fs.mkdir(BASE_DIR, { recursive: true });
    
    const topic = researchContext?.topic || 'unnamed_research';
    const runDirName = getRunDirectoryName(topic);
    const runPath = path.join(BASE_DIR, runDirName);
    
    try {
      await fs.access(runPath);
    } catch {
      await fs.mkdir(runPath, { recursive: true });
    }
    
    currentRunPath = runPath;
    
    metaData = {
      topic: topic,
      startedAt: researchContext?.startTime || new Date().toISOString(),
      status: 'running',
      pageCount: 0,
      runId: researchContext?.runId || null,
      maxPages: researchContext?.maxPages || 200
    };
    
    const metaPath = path.join(runPath, 'meta.json');
    await atomicWrite(metaPath, metaData);
    
    const questionsPath = path.join(runPath, 'questions.json');
    try {
      await fs.access(questionsPath);
    } catch {
      await atomicWrite(questionsPath, []);
    }
    
    const pagesPath = path.join(runPath, 'pages.jsonl');
    try {
      await fs.access(pagesPath);
    } catch {
      await fs.writeFile(pagesPath, '', 'utf8');
    }
    
    const finalPath = path.join(runPath, 'final.json');
    try {
      await fs.access(finalPath);
    } catch {
      await atomicWrite(finalPath, null);
    }
    
    try {
      const existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      metaData.pageCount = existingMeta.pageCount || 0;
      metaData.status = 'running';
      await atomicWrite(metaPath, metaData);
    } catch (e) {
    }
    
  } catch (error) {
    console.warn('Storage initialization failed:', error.message);
    currentRunPath = null;
    metaData = null;
  }
}

async function saveQuestionTree(questionTree) {
  if (!currentRunPath || !Array.isArray(questionTree)) {
    return false;
  }
  
  try {
    const filePath = path.join(currentRunPath, 'questions.json');
    await atomicWrite(filePath, questionTree);
    return true;
  } catch (error) {
    console.warn('Failed to save question tree:', error.message);
    return false;
  }
}

async function savePageResult(pageObject) {
  if (!currentRunPath || !pageObject || typeof pageObject !== 'object') {
    return false;
  }
  
  if (shutdownRequested) {
    return false;
  }
  
  return new Promise((resolve) => {
    writeQueue.push({
      type: 'page',
      data: pageObject,
      resolve
    });
    processQueue();
  });
}

async function saveSynthesis(finalObject) {
  if (!currentRunPath || !finalObject || typeof finalObject !== 'object') {
    return false;
  }
  
  if (shutdownRequested) {
    return false;
  }
  
  return new Promise((resolve) => {
    writeQueue.push({
      type: 'final',
      data: finalObject,
      resolve
    });
    processQueue();
  });
}

async function processQueue() {
  if (processingQueue || writeQueue.length === 0 || shutdownRequested) {
    return;
  }
  
  processingQueue = true;
  
  while (writeQueue.length > 0 && !shutdownRequested) {
    const task = writeQueue.shift();
    
    try {
      if (task.type === 'page') {
        const pagesPath = path.join(currentRunPath, 'pages.jsonl');
        const line = JSON.stringify(task.data) + '\n';
        await fs.appendFile(pagesPath, line, 'utf8');
        
        if (metaData) {
          metaData.pageCount = (metaData.pageCount || 0) + 1;
          const metaPath = path.join(currentRunPath, 'meta.json');
          const metaCopy = { ...metaData };
          await atomicWrite(metaPath, metaCopy);
        }
        
        task.resolve(true);
      } else if (task.type === 'final') {
        const finalPath = path.join(currentRunPath, 'final.json');
        await atomicWrite(finalPath, task.data);
        
        if (metaData) {
          metaData.status = 'completed';
          const metaPath = path.join(currentRunPath, 'meta.json');
          const metaCopy = { ...metaData };
          await atomicWrite(metaPath, metaCopy);
        }
        
        task.resolve(true);
      }
    } catch (error) {
      console.warn(`Failed to process ${task.type}:`, error.message);
      task.resolve(false);
    }
  }
  
  processingQueue = false;
}

async function flush() {
  if (isFlushing) {
    return;
  }
  
  isFlushing = true;
  shutdownRequested = true;
  
  try {
    while (writeQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (processingQueue) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    if (currentRunPath && metaData) {
      try {
        const metaPath = path.join(currentRunPath, 'meta.json');
        
        const finalPath = path.join(currentRunPath, 'final.json');
        let hasFinal = false;
        try {
          const finalContent = await fs.readFile(finalPath, 'utf8');
          const parsed = JSON.parse(finalContent);
          hasFinal = parsed !== null;
        } catch {
          hasFinal = false;
        }
        
        if (!hasFinal && metaData.status === 'running') {
          metaData.status = 'interrupted';
          const metaCopy = { ...metaData };
          await atomicWrite(metaPath, metaCopy);
        }
      } catch (error) {
        console.warn('Failed to update meta during flush:', error.message);
      }
    }
  } catch (error) {
    console.warn('Flush error:', error.message);
  } finally {
    isFlushing = false;
  }
}

process.on('beforeExit', async () => {
  if (!shutdownRequested) {
    await flush();
  }
});

process.on('SIGINT', async () => {
  if (!shutdownRequested) {
    await flush();
  }
});

process.on('SIGTERM', async () => {
  if (!shutdownRequested) {
    await flush();
  }
});

module.exports = {
  initialize,
  saveQuestionTree,
  savePageResult,
  saveSynthesis,
  flush
};
