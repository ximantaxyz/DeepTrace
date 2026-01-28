#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const fs = require('fs').promises;

const questioner = require('./questioner.js');
const refiner = require('./refiner.js');
const inspector = require('./inspector.js');
const storage = require('./storage.js');
const synthesizer = require('./synthesizer.js');

const cancellationToken = {
  cancelled: false,
  reason: null,
  abortController: new AbortController()
};

let activeOperations = 0;
let finalizationDone = false;
let progressInterval = null;
let shutdownInProgress = false;

const researchContext = {
  runId: null,
  topic: null,
  maxPages: 200,
  startTime: null
};

const stats = {
  currentQuestion: '',
  pagesVisited: 0
};

const visitedUrls = new Set();

const storageQueue = [];
let storageQueueProcessing = false;

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

const globalSemaphore = new Semaphore(5);

async function processStorageQueue() {
  if (storageQueueProcessing) {
    return;
  }
  storageQueueProcessing = true;

  while (storageQueue.length > 0) {
    const task = storageQueue.shift();
    try {
      await task.fn();
      task.resolve();
    } catch (error) {
      task.reject(error);
    }
  }

  storageQueueProcessing = false;
}

function queueStorageOperation(fn) {
  return new Promise((resolve, reject) => {
    storageQueue.push({ fn, resolve, reject });
    processStorageQueue();
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function shouldContinue() {
  if (cancellationToken.cancelled) {
    return false;
  }
  if (stats.pagesVisited >= researchContext.maxPages) {
    if (!cancellationToken.cancelled) {
      cancellationToken.cancelled = true;
      cancellationToken.reason = 'MAX_PAGES_REACHED';
      cancellationToken.abortController.abort();
    }
    return false;
  }
  return true;
}

function reportProgress(pagesVisited, currentQuestion) {
  stats.pagesVisited = pagesVisited;
  if (currentQuestion) {
    stats.currentQuestion = currentQuestion;
  }
}

function clearProgressLine() {
  process.stdout.write('\r' + ' '.repeat(120) + '\r');
}

async function finalize() {
  if (finalizationDone) {
    return;
  }
  finalizationDone = true;

  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  clearProgressLine();

  console.log('\nFinalizing...');

  while (activeOperations > 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await queueStorageOperation(() => storage.flush());

  console.log('Finalization complete.');
}

function setupShutdownHandlers() {
  const gracefulShutdown = async (reason) => {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;

    if (cancellationToken.cancelled) {
      return;
    }

    cancellationToken.cancelled = true;
    cancellationToken.reason = reason || 'USER_INTERRUPT';
    cancellationToken.abortController.abort();

    console.log('\n\nShutdown requested. Cleaning up...');

    await finalize();

    if (rl && !rl.closed) {
      rl.removeAllListeners();
      rl.close();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  process.stdin.on('end', () => gracefulShutdown('STDIN_END'));

  rl.on('close', async () => {
    if (!shutdownInProgress && !cancellationToken.cancelled) {
      await gracefulShutdown('RL_CLOSE');
    }
  });
}

async function collectInput() {
  console.log('=== CLI Research Engine ===\n');

  const topic = await question('Enter main research topic (required): ');
  if (!topic.trim()) {
    console.log('Error: Topic is required.');
    process.exit(1);
  }

  const extraInstruction = await question('Enter optional extra instruction/focus (press Enter to skip): ');

  console.log('\nEnter URLs (one per line, press Enter on empty line to finish):');
  const urls = [];
  while (true) {
    const url = await question('URL: ');
    if (!url.trim()) {
      break;
    }
    urls.push(url.trim());
  }

  return {
    topic: topic.trim(),
    extraInstruction: extraInstruction.trim() || null,
    urls
  };
}

async function displayProgress() {
  const lines = [
    `\rCurrent: ${stats.currentQuestion || 'N/A'}`,
    ` | Pages visited: ${stats.pagesVisited}/${researchContext.maxPages}`
  ];
  process.stdout.write(lines.join(''));
}

async function runResearch(input) {
  console.log('\n=== Starting Research ===\n');

  researchContext.runId = Date.now().toString();
  researchContext.topic = input.topic;
  researchContext.startTime = new Date().toISOString();

  try {
    await queueStorageOperation(() => storage.initialize(researchContext));
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  }

  console.log('Generating initial questions...');
  activeOperations++;
  let initialQuestions;
  try {
    initialQuestions = await questioner.generateInitialQuestions(
      input.topic,
      input.extraInstruction,
      researchContext,
      cancellationToken
    );
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  } finally {
    activeOperations--;
  }

  if (!shouldContinue()) return;

  console.log('Refining question tree...');
  activeOperations++;
  let questionTree;
  try {
    questionTree = await refiner.refineQuestionTree(
      initialQuestions,
      researchContext,
      cancellationToken
    );
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  } finally {
    activeOperations--;
  }

  if (!shouldContinue()) return;

  try {
    await queueStorageOperation(() => storage.saveQuestionTree(questionTree));
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  }

  console.log('Inspecting pages...\n');

  progressInterval = setInterval(() => {
    if (shouldContinue()) {
      displayProgress();
    }
  }, 500);

  try {
    for (const rootQuestion of questionTree) {
      if (!shouldContinue()) break;

      stats.currentQuestion = rootQuestion.question;

      await globalSemaphore.acquire();
      activeOperations++;
      try {
        await inspector.inspectQuestion(
          rootQuestion,
          input.urls,
          researchContext,
          cancellationToken,
          { shouldContinue, reportProgress, visitedUrls }
        );
      } finally {
        activeOperations--;
        globalSemaphore.release();
      }

      if (!shouldContinue()) break;

      for (const subQuestion of rootQuestion.subQuestions || []) {
        if (!shouldContinue()) break;

        stats.currentQuestion = subQuestion.question;

        await globalSemaphore.acquire();
        activeOperations++;
        try {
          await inspector.inspectQuestion(
            subQuestion,
            input.urls,
            researchContext,
            cancellationToken,
            { shouldContinue, reportProgress, visitedUrls }
          );
        } finally {
          activeOperations--;
          globalSemaphore.release();
        }
      }
    }
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  }

  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  clearProgressLine();

  if (!shouldContinue()) {
    console.log('\nResearch stopped: ' + (cancellationToken.reason || 'Unknown'));
    return;
  }

  if (stats.pagesVisited < 20) {
    console.log('\nInsufficient data collected (minimum 20 pages required). Skipping synthesis.');
    return;
  }

  console.log('\nInspection complete. Synthesizing report...');

  await globalSemaphore.acquire();
  activeOperations++;
  try {
    await synthesizer.synthesize(researchContext, cancellationToken);
  } catch (error) {
    cancellationToken.cancelled = true;
    cancellationToken.reason = 'PHASE_ERROR';
    cancellationToken.abortController.abort();
    throw error;
  } finally {
    activeOperations--;
    globalSemaphore.release();
  }

  console.log('Research complete!');
}

async function main() {
  setupShutdownHandlers();

  try {
    const input = await collectInput();

    if (rl && !rl.closed) {
      rl.removeAllListeners('close');
      rl.close();
    }

    await runResearch(input);

    await finalize();

    if (!cancellationToken.cancelled) {
      process.exit(0);
    }
  } catch (error) {
    clearProgressLine();

    if (!cancellationToken.cancelled) {
      console.error('\nFatal error:', error.message);
    }

    await finalize();

    process.exit(1);
  }
}

main();