// Global state
let isRunning = false;
let intervalId = null;
let currentTabId = null;
let processQueue = [];
let processedToday = 0;
let processedCount = 0; // Track total processed in current session
let actionType = 'unfriend'; // 'unfriend' or 'unfollow'

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getStatus':
      sendResponse({ 
        isRunning, 
        processedToday,
        processedCount,
        remainingCount: processQueue.length
      });
      break;
      
    case 'startUnfriending':
      actionType = 'unfriend';
      startProcess(request.settings, sendResponse);
      return true; // Keep the message channel open for async response
      
    case 'startUnfollowing':
      actionType = 'unfollow';
      startProcess(request.settings, sendResponse);
      return true; // Keep the message channel open for async response
      
    case 'stopUnfriending':
      const result = stopProcess();
      sendResponse({ 
        status: 'stopped',
        processedCount: result.processedCount
      });
      break;
  }
});

/**
 * Start the unfriending/unfollowing process
 */
async function startProcess(settings, sendResponse) {
  if (isRunning) {
    sendResponse({ status: 'already_running' });
    return;
  }
  
  try {
    isRunning = true;
    processedCount = 0; // Reset processed count for this session
    
    // Get active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || !tabs[0].url.includes('facebook.com')) {
      isRunning = false;
      sendResponse({ status: 'error', message: 'Please navigate to Facebook first' });
      return;
    }
    
    currentTabId = tabs[0].id;
    
    // Get today's count from storage
    const today = new Date().toDateString();
    const data = await chrome.storage.sync.get(['dailyCount', 'lastReset']);
    let dailyCount = data.dailyCount || {};
    const lastReset = data.lastReset || '';
    
    // Reset count if it's a new day
    if (lastReset !== today) {
      dailyCount = {};
      dailyCount[today] = 0;
      await chrome.storage.sync.set({ lastReset: today, dailyCount });
    }
    
    processedToday = dailyCount[today] || 0;
    
    // Get friends list
    const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getFriends' });
    if (!response || !response.friends || response.friends.length === 0) {
      isRunning = false;
      sendResponse({ status: 'error', message: 'No friends found. Make sure you\'re on the Facebook friends page.' });
      return;
    }
    
    // Filter out whitelisted friends
    processQueue = response.friends
      .filter(friend => !settings.whitelist.includes(friend.id))
      .map(friend => friend.id);
    
    // Start the process
    // Use the delay value from settings directly (it's already in milliseconds)
    const delay = settings.delay;
    const limit = Math.max(parseInt(settings.limit) || 75, 1);
    
    console.log(`Starting process with delay: ${delay/1000} seconds, limit: ${limit}`);
    
    sendResponse({ 
      status: 'started', 
      friendCount: processQueue.length,
      dailyLimit: limit,
      processedToday
    });
    
    // Process friends with delay
    processNextFriend(delay, limit, today);
    
  } catch (error) {
    console.error('Error starting process:', error);
    isRunning = false;
    sendResponse({ status: 'error', message: error.message });
  }
}

/**
 * Process the next friend in the queue
 */
async function processNextFriend(delay, limit, today) {
  if (!isRunning || processQueue.length === 0 || processedToday >= limit) {
    stopProcess();
    return;
  }
  
  try {
    // Check if the tab is still valid
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || tabs[0].id !== currentTabId) {
      stopProcess();
      return;
    }
    
    const friendId = processQueue.shift();
    
    // Send message to content script to unfriend/unfollow
    const action = actionType === 'unfriend' ? 'unfriend' : 'unfollow';
    console.log(`Attempting to ${action} friend with ID: ${friendId}`);
    
    // Add a retry mechanism for more reliability
    let result = null;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        result = await chrome.tabs.sendMessage(currentTabId, { 
          action, 
          id: friendId 
        });
        
        if (result && result.success) {
          break; // Success, exit retry loop
        } else {
          console.log(`Attempt ${retryCount + 1} failed: ${result?.error || 'Unknown error'}`);
          retryCount++;
          
          if (retryCount <= maxRetries) {
            console.log(`Retrying in 3 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      } catch (error) {
        console.error(`Error in attempt ${retryCount + 1}:`, error);
        retryCount++;
        
        if (retryCount <= maxRetries) {
          console.log(`Retrying in 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    if (result && result.success) {
      // Increment counters
      processedToday++;
      processedCount++;
      
      // Update storage
      const data = await chrome.storage.sync.get(['dailyCount']);
      const dailyCount = data.dailyCount || {};
      dailyCount[today] = processedToday;
      await chrome.storage.sync.set({ dailyCount });
      
      // Log success
      console.log(`${action === 'unfriend' ? 'Unfriended' : 'Unfollowed'} ${result.name}`);
    } else {
      console.error(`Failed to ${action} after ${maxRetries + 1} attempts:`, result?.error || 'Unknown error');
      
      // Put the friend back at the end of the queue for a later attempt if we have retries left
      if (processQueue.length < 50) { // Prevent infinite loops with too many failed friends
        console.log(`Adding friend back to the end of the queue for later processing`);
        processQueue.push(friendId);
      }
    }
    
    // Use the delay passed from startProcess directly
    // Add a small random variation to make it more natural (±250ms)
    const randomizedDelay = delay + (Math.random() * 500 - 250);
    console.log(`Waiting ${randomizedDelay/1000} seconds before processing next friend`);
    
    // Schedule next friend with delay
    intervalId = setTimeout(() => {
      processNextFriend(delay, limit, today);
    }, randomizedDelay);
    
  } catch (error) {
    console.error('Error processing friend:', error);
    
    // Continue with next friend after the original delay
    intervalId = setTimeout(() => {
      processNextFriend(delay, limit, today);
    }, delay);
  }
}

/**
 * Stop the unfriending/unfollowing process
 */
function stopProcess() {
  const result = {
    processedCount,
    remainingCount: processQueue.length
  };
  
  isRunning = false;
  if (intervalId) {
    clearTimeout(intervalId);
    intervalId = null;
  }
  console.log(`Process stopped. Processed ${processedCount} friends.`);
  
  return result;
}

// Initialize daily count on extension load
chrome.runtime.onInstalled.addListener(() => {
  const today = new Date().toDateString();
  chrome.storage.sync.get(['dailyCount', 'lastReset'], (data) => {
    if (!data.lastReset || data.lastReset !== today) {
      chrome.storage.sync.set({ 
        lastReset: today,
        dailyCount: { [today]: 0 }
      });
    }
  });
}); 