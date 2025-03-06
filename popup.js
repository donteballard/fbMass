document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const searchInput = document.getElementById('search');
  const refreshBtn = document.getElementById('refresh');
  const friendListElement = document.getElementById('friendList');
  const delayInput = document.getElementById('delay');
  const limitInput = document.getElementById('limit');
  const startBtn = document.getElementById('start');
  const startUnfollowBtn = document.getElementById('startUnfollow');
  const stopBtn = document.getElementById('stop');
  const statusElement = document.getElementById('status');
  const loadAllBtn = document.getElementById('loadAll');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const resetSettingsBtn = document.getElementById('resetSettings');

  // State variables
  let friends = [];
  let whitelist = new Set();
  let isProcessing = false;
  let lastError = '';
  let isLoadingAll = false;

  // Default values from HTML
  const DEFAULT_DELAY = 2;
  const DEFAULT_LIMIT = 500;

  // Function to reset settings to defaults
  function resetToDefaults(showConfirmation = false) {
    if (showConfirmation) {
      // Forced reset with confirmation
      applyDefaults(true);
    } else {
      // Check if values need to be reset
      chrome.storage.sync.get(['delay', 'limit'], (data) => {
        const currentDelay = data.delay;
        const currentLimit = data.limit;
        
        // Check if values need to be reset
        const needsReset = (
          currentDelay === undefined || 
          currentDelay === null || 
          currentDelay > 30 || 
          currentLimit === undefined || 
          currentLimit === null
        );
        
        if (needsReset) {
          applyDefaults(false);
        } else {
          console.log(`Using stored settings: delay=${currentDelay}, limit=${currentLimit}`);
        }
      });
    }
  }
  
  // Helper function to apply default values
  function applyDefaults(showConfirmation) {
    console.log('Applying default settings');
    chrome.storage.sync.set({ 
      delay: DEFAULT_DELAY, 
      limit: DEFAULT_LIMIT 
    }, () => {
      console.log(`Settings reset to defaults: delay=${DEFAULT_DELAY}, limit=${DEFAULT_LIMIT}`);
      // Update input fields
      delayInput.value = DEFAULT_DELAY;
      limitInput.value = DEFAULT_LIMIT;
      
      if (showConfirmation) {
        statusElement.textContent = `Settings reset to defaults (Delay: ${DEFAULT_DELAY}s, Limit: ${DEFAULT_LIMIT})`;
        statusElement.className = 'status success';
        setTimeout(() => {
          if (statusElement.textContent.includes('Settings reset')) {
            statusElement.textContent = '';
            statusElement.className = 'status';
          }
        }, 3000);
      }
    });
  }

  // Reset settings to defaults on load
  resetToDefaults();

  // Load saved settings
  chrome.storage.sync.get(['whitelist', 'delay', 'limit'], (data) => {
    if (data.whitelist) whitelist = new Set(data.whitelist);
    if (data.delay) {
      // Validate delay is within reasonable bounds (1-30 seconds)
      const parsedDelay = parseInt(data.delay);
      delayInput.value = Math.min(Math.max(parsedDelay, 1), 30);
    } else {
      delayInput.value = DEFAULT_DELAY; // Default to 2 seconds if not set
    }
    if (data.limit) {
      limitInput.value = data.limit;
    } else {
      limitInput.value = DEFAULT_LIMIT; // Default to 500 if not set
    }
  });

  // Add input validation for delay
  delayInput.addEventListener('change', () => {
    const value = parseInt(delayInput.value);
    if (isNaN(value) || value < 1) {
      delayInput.value = 1; // Minimum 1 second
    } else if (value > 30) {
      delayInput.value = 30; // Maximum 30 seconds
    }
    
    // Save the validated value
    chrome.storage.sync.set({ delay: parseInt(delayInput.value) });
    console.log(`Delay set to ${delayInput.value} seconds`);
  });
  
  // Add input validation for limit
  limitInput.addEventListener('change', () => {
    const value = parseInt(limitInput.value);
    if (isNaN(value) || value < 1) {
      limitInput.value = DEFAULT_LIMIT; // Default to 500 if invalid
    }
    
    // Save the validated value
    chrome.storage.sync.set({ limit: parseInt(limitInput.value) });
    console.log(`Limit set to ${limitInput.value}`);
  });

  // Check if unfriending process is running
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response) {
      isProcessing = response.isRunning;
      updateUI();
      
      if (response.isRunning) {
        statusElement.textContent = `Processing... ${response.processedCount} friends processed so far.`;
        statusElement.className = 'status';
      }
    }
  });
  
  // Check if "Load All Friends" was in progress
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url?.includes('facebook.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getLoadingStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Could not check loading status:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.isLoadingAll) {
          // Loading was in progress
          isLoadingAll = true;
          loadAllBtn.textContent = 'Loading...';
          loadAllBtn.disabled = true;
          progressContainer.style.display = 'block';
          
          if (response.lastProgressUpdate) {
            const update = response.lastProgressUpdate;
            progressFill.style.width = `${update.progress}%`;
            progressText.textContent = update.message;
            statusElement.textContent = `Found ${update.friendsCount} friends so far...`;
            
            // If the process was done, update the UI
            if (update.done) {
              isLoadingAll = false;
              loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
              loadAllBtn.disabled = false;
              statusElement.textContent = `Loaded ${update.friendsCount} friends`;
              statusElement.className = 'status success';
              
              // Refresh the friends list
              refreshFriends();
            }
          }
        }
      });
    }
  });

  // Get friends list from content script
  function loadFriends() {
    friendListElement.innerHTML = '<div class="status">Loading friends...</div>';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url?.includes('facebook.com')) {
        friendListElement.innerHTML = '<div class="status error">Please navigate to Facebook to use this extension</div>';
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getFriends' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error loading friends:', chrome.runtime.lastError);
          friendListElement.innerHTML = `<div class="status error">Error: ${chrome.runtime.lastError.message || 'Could not connect to Facebook page'}</div>`;
          return;
        }
        
        if (!response) {
          friendListElement.innerHTML = '<div class="status error">Error loading friends. Make sure you\'re on Facebook.</div>';
          return;
        }
        
        if (response.error) {
          friendListElement.innerHTML = `<div class="status error">Error: ${response.error}</div>`;
          return;
        }
        
        friends = response.friends || [];
        if (friends.length === 0) {
          friendListElement.innerHTML = '<div class="status">No friends found. Navigate to your friends list on Facebook.</div>';
        } else {
          renderFriends(friends);
          statusElement.textContent = `Loaded ${friends.length} friends`;
          statusElement.className = 'status success';
        }
      });
    });
  }

  // Refresh friends list
  function refreshFriends() {
    friendListElement.innerHTML = '<div class="status">Refreshing friends list...</div>';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url?.includes('facebook.com')) {
        friendListElement.innerHTML = '<div class="status error">Please navigate to Facebook to use this extension</div>';
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshFriends' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error refreshing friends:', chrome.runtime.lastError);
          friendListElement.innerHTML = `<div class="status error">Error: ${chrome.runtime.lastError.message || 'Could not connect to Facebook page'}</div>`;
          return;
        }
        
        if (!response) {
          friendListElement.innerHTML = '<div class="status error">Error refreshing friends. Make sure you\'re on Facebook.</div>';
          return;
        }
        
        if (response.error) {
          friendListElement.innerHTML = `<div class="status error">Error: ${response.error}</div>`;
          return;
        }
        
        friends = response.friends || [];
        if (friends.length === 0) {
          friendListElement.innerHTML = '<div class="status">No friends found. Navigate to your friends list on Facebook.</div>';
        } else {
          renderFriends(friends);
          statusElement.textContent = `Refreshed: ${friends.length} friends loaded`;
          statusElement.className = 'status success';
        }
      });
    });
  }

  // Load all friends by auto-scrolling
  function loadAllFriends() {
    if (isLoadingAll) return;
    
    isLoadingAll = true;
    loadAllBtn.textContent = 'Loading...';
    loadAllBtn.disabled = true;
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starting to load all friends...';
    statusElement.textContent = 'Loading all friends...';
    statusElement.className = 'status';
    
    // Get the current daily limit and validate it
    let currentLimit = parseInt(limitInput.value) || DEFAULT_LIMIT;
    if (currentLimit < 1) currentLimit = DEFAULT_LIMIT;
    
    // Validate delay value
    let currentDelay = parseInt(delayInput.value) || DEFAULT_DELAY;
    if (currentDelay < 1) currentDelay = 1;
    if (currentDelay > 30) currentDelay = 30;
    
    // Update the input fields with validated values
    delayInput.value = currentDelay;
    limitInput.value = currentLimit;
    
    // Save the validated values
    chrome.storage.sync.set({ 
      limit: currentLimit,
      delay: currentDelay
    }, () => {
      console.log(`Settings saved: limit=${currentLimit}, delay=${currentDelay}`);
    });
    
    // Add abort button
    const abortBtn = document.createElement('button');
    abortBtn.textContent = 'Stop Loading';
    abortBtn.style.marginTop = '5px';
    abortBtn.style.backgroundColor = '#e74c3c';
    abortBtn.style.color = 'white';
    abortBtn.style.border = 'none';
    abortBtn.style.borderRadius = '4px';
    abortBtn.style.padding = '5px 10px';
    abortBtn.style.cursor = 'pointer';
    abortBtn.style.fontSize = '12px';
    
    abortBtn.addEventListener('click', () => {
      abortBtn.textContent = 'Stopping...';
      abortBtn.disabled = true;
      statusElement.textContent = 'Stopping the loading process...';
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.url?.includes('facebook.com')) {
          statusElement.textContent = 'Error: Could not connect to Facebook';
          return;
        }
        
        chrome.tabs.sendMessage(tabs[0].id, { action: 'abortLoadingAll' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error aborting loading:', chrome.runtime.lastError);
            statusElement.textContent = 'Error stopping the process. Please try again.';
            abortBtn.textContent = 'Stop Loading';
            abortBtn.disabled = false;
            return;
          }
          
          console.log('Abort request sent successfully:', response);
          
          if (response && response.friendsLoaded > 0) {
            statusElement.textContent = `Stopping... ${response.friendsLoaded} friends loaded so far.`;
          } else {
            statusElement.textContent = 'Stopping... This may take a moment.';
          }
          
          // Check if the process has stopped after a short delay
          setTimeout(() => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getLoadingStatus' }, (statusResponse) => {
              if (chrome.runtime.lastError || !statusResponse) {
                console.log('Could not check loading status after abort');
                return;
              }
              
              if (!statusResponse.isLoadingAll) {
                // Process has stopped
                if (statusResponse.lastLoadedFriends && statusResponse.lastLoadedFriends.length > 0) {
                  statusElement.textContent = `Loading stopped. Found ${statusResponse.lastLoadedFriends.length} friends.`;
                } else {
                  statusElement.textContent = 'Loading process stopped successfully.';
                }
                
                isLoadingAll = false;
                loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
                loadAllBtn.disabled = false;
                
                // Remove abort button
                if (progressContainer.contains(abortBtn)) {
                  progressContainer.removeChild(abortBtn);
                }
                
                // Request the latest friends data
                requestLatestFriendsData();
              } else {
                // Process is still running, check again after a delay
                setTimeout(() => {
                  requestLatestFriendsData();
                  
                  // Update UI to show we're no longer loading
                  isLoadingAll = false;
                  loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
                  loadAllBtn.disabled = false;
                  
                  // Remove abort button
                  if (progressContainer.contains(abortBtn)) {
                    progressContainer.removeChild(abortBtn);
                  }
                }, 2000);
              }
            });
          }, 2000);
        });
      });
    });
    
    progressContainer.appendChild(abortBtn);
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url?.includes('facebook.com')) {
        progressText.textContent = 'Error: Please navigate to Facebook';
        statusElement.textContent = 'Error: Please navigate to Facebook';
        statusElement.className = 'status error';
        isLoadingAll = false;
        loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
        loadAllBtn.disabled = false;
        
        // Remove abort button
        if (progressContainer.contains(abortBtn)) {
          progressContainer.removeChild(abortBtn);
        }
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'loadAllFriends' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error loading all friends:', chrome.runtime.lastError);
          const errorMsg = chrome.runtime.lastError.message || 'Could not connect to Facebook page';
          progressText.textContent = `Error: ${errorMsg}`;
          statusElement.textContent = `Error: ${errorMsg}`;
          statusElement.className = 'status error';
          isLoadingAll = false;
          loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
          loadAllBtn.disabled = false;
          
          // Remove abort button
          if (progressContainer.contains(abortBtn)) {
            progressContainer.removeChild(abortBtn);
          }
          
          // Show a more helpful message if it's a connection error
          if (errorMsg.includes('connect') || errorMsg.includes('establish')) {
            statusElement.textContent = 'Error: Please refresh the Facebook page and try again';
          }
          return;
        }
        
        console.log('Started loading all friends');
      });
    });
    
    // For handling chunked friend data
    let accumulatedFriends = [];
    let expectedTotalChunks = 0;
    
    // Listen for progress updates
    chrome.runtime.onMessage.addListener(function progressListener(message) {
      if (message.action === 'loadAllFriendsProgress') {
        progressFill.style.width = `${message.progress}%`;
        progressText.textContent = message.message;
        
        // If this is an abort message, update the UI accordingly
        if (message.message && message.message.includes('aborted')) {
          isLoadingAll = false;
          loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
          loadAllBtn.disabled = false;
          statusElement.textContent = message.message;
          
          // Remove abort button
          if (progressContainer.contains(abortBtn)) {
            progressContainer.removeChild(abortBtn);
          }
          
          // If we have friends data in the abort message, use it
          if (message.friends && message.friends.length > 0) {
            friends = message.friends;
            renderFriends(friends);
          } else {
            // Otherwise request the latest data
            requestLatestFriendsData();
          }
          
          // Remove the listener
          chrome.runtime.onMessage.removeListener(progressListener);
          
          // Hide progress bar after a delay
          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 3000);
          
          return;
        }
        
        // If this is a limit reached message, update the UI accordingly
        if (message.message && message.message.includes('limit')) {
          isLoadingAll = false;
          loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
          loadAllBtn.disabled = false;
          statusElement.textContent = message.message;
          
          // Remove abort button
          if (progressContainer.contains(abortBtn)) {
            progressContainer.removeChild(abortBtn);
          }
          
          // If we have friends data in the message, use it
          if (message.friends && message.friends.length > 0) {
            friends = message.friends;
            renderFriends(friends);
          } else {
            // Otherwise request the latest data
            requestLatestFriendsData();
          }
          
          // Remove the listener
          chrome.runtime.onMessage.removeListener(progressListener);
          
          // Hide progress bar after a delay
          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 3000);
          
          return;
        }
        
        // Handle chunked data for large friend lists
        if (message.totalChunks && message.totalChunks > 1) {
          expectedTotalChunks = message.totalChunks;
          
          // Add this chunk to our accumulated friends
          if (message.friends && message.friends.length > 0) {
            accumulatedFriends = [...accumulatedFriends, ...message.friends];
            console.log(`Received chunk ${message.chunkIndex + 1}/${message.totalChunks} with ${message.friends.length} friends. Total accumulated: ${accumulatedFriends.length}`);
          }
          
          // Update status with progress of receiving chunks
          statusElement.textContent = `Receiving data: chunk ${message.chunkIndex + 1}/${message.totalChunks} (${accumulatedFriends.length}/${message.friendsCount} friends)`;
          
          // Only process the final result when we've received the last chunk
          if (message.done) {
            console.log(`Received all ${accumulatedFriends.length} friends in ${message.totalChunks} chunks`);
            processCompletedFriendLoading(accumulatedFriends, message.friendsCount);
            
            // Reset for next time
            accumulatedFriends = [];
            expectedTotalChunks = 0;
            
            // Remove the listener after completion
            chrome.runtime.onMessage.removeListener(progressListener);
          }
        } else {
          // Update status with progress
          if (message.friendsCount && message.friendsCount > 0) {
            statusElement.textContent = `Found ${message.friendsCount} friends so far...`;
          }
          
          // For non-chunked updates or small friend lists
          if (message.progress >= 100 || message.done) {
            // If we have friends data, use it
            if (message.friends && message.friends.length > 0) {
              processCompletedFriendLoading(message.friends, message.friendsCount);
            } 
            // If we only have a count but no friends data (for large lists during progress updates)
            else if (message.friendsCount > 0) {
              statusElement.textContent = `Found ${message.friendsCount} friends`;
              statusElement.className = 'status success';
              
              // Request the latest friends data
              requestLatestFriendsData();
            } else {
              statusElement.textContent = 'No friends found. Try scrolling manually first.';
              statusElement.className = 'status error';
            }
            
            // Remove the listener after completion
            chrome.runtime.onMessage.removeListener(progressListener);
          }
        }
      }
    });
    
    // Helper function to process completed friend loading
    function processCompletedFriendLoading(friendsList, totalCount) {
      isLoadingAll = false;
      loadAllBtn.textContent = 'Load All Friends (Auto-scroll)';
      loadAllBtn.disabled = false;
      
      // Remove abort button
      if (progressContainer.contains(abortBtn)) {
        progressContainer.removeChild(abortBtn);
      }
      
      // Update friends list with the new data
      if (friendsList && friendsList.length > 0) {
        friends = friendsList;
        renderFriends(friends);
        statusElement.textContent = `Successfully loaded ${friends.length} friends`;
        statusElement.className = 'status success';
      } else {
        statusElement.textContent = 'No friends found. Try scrolling manually first.';
        statusElement.className = 'status error';
      }
      
      // Hide progress bar after a delay
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 3000);
    }
  }

  // Function to request the latest friends data from the content script
  function requestLatestFriendsData() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url?.includes('facebook.com')) {
        console.log('Not on Facebook, cannot request friends data');
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getLatestFriendsData' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error requesting latest friends data:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.friends && response.friends.length > 0) {
          console.log(`Received ${response.friends.length} friends from content script`);
          friends = response.friends;
          renderFriends(friends);
          statusElement.textContent = `Successfully loaded ${friends.length} friends`;
          statusElement.className = 'status success';
        }
      });
    });
  }

  // Render friends list with checkboxes
  function renderFriends(friendsToRender) {
    friendListElement.innerHTML = '';
    
    // Add header with explanation
    const header = document.createElement('div');
    header.className = 'friend-list-header';
    header.innerHTML = `
      <span>Friends (${friendsToRender.length})</span>
      <span class="tooltip" title="Click for help">?
        <span class="tooltiptext">Check the boxes next to friends you want to KEEP in your friends list (whitelist). Any friends that are not checked will be processed for unfriending/unfollowing.</span>
      </span>
    `;
    friendListElement.appendChild(header);
    
    if (friendsToRender.length === 0) {
      const div = document.createElement('div');
      div.className = 'status';
      div.textContent = 'No friends match your search';
      friendListElement.appendChild(div);
      return;
    }
    
    friendsToRender.forEach(friend => {
      const div = document.createElement('div');
      div.className = 'friend-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `friend-${friend.id}`;
      checkbox.checked = whitelist.has(friend.id);
      checkbox.title = 'Check to KEEP this friend (whitelist)';
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          whitelist.add(friend.id);
        } else {
          whitelist.delete(friend.id);
        }
        saveWhitelist();
      });
      
      const label = document.createElement('label');
      label.htmlFor = `friend-${friend.id}`;
      label.textContent = friend.name;
      label.title = 'Check to KEEP this friend (whitelist)';
      
      div.appendChild(checkbox);
      div.appendChild(label);
      friendListElement.appendChild(div);
    });
  }

  // Save whitelist to storage
  function saveWhitelist() {
    chrome.storage.sync.set({ whitelist: Array.from(whitelist) });
  }

  // Update UI based on processing state
  function updateUI() {
    startBtn.disabled = isProcessing;
    startUnfollowBtn.disabled = isProcessing;
    stopBtn.disabled = !isProcessing;
    refreshBtn.disabled = isProcessing;
    loadAllBtn.disabled = isProcessing || isLoadingAll;
    
    if (isProcessing) {
      statusElement.textContent = 'Process in progress...';
      statusElement.className = 'status';
    } else if (lastError) {
      statusElement.textContent = `Error: ${lastError}`;
      statusElement.className = 'status error';
      lastError = '';
    }
  }

  // Check if the process has completed
  function checkProcessCompletion() {
    if (!isProcessing) return;
    
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error checking completion status:', chrome.runtime.lastError);
        return;
      }
      
      if (response && !response.isRunning && isProcessing) {
        // Process has completed
        isProcessing = false;
        statusElement.textContent = `Process completed! Processed ${response.processedCount || 0} friends.`;
        statusElement.className = 'status success';
        updateUI();
      } else if (response && response.isRunning) {
        // Process is still running, check again in 2 seconds
        setTimeout(checkProcessCompletion, 2000);
      }
    });
  }

  // Event listeners
  searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    const filtered = friends.filter(f => f.name.toLowerCase().includes(searchTerm));
    renderFriends(filtered);
  });

  refreshBtn.addEventListener('click', refreshFriends);
  
  loadAllBtn.addEventListener('click', loadAllFriends);

  startBtn.addEventListener('click', () => {
    // Validate delay value
    let delay = parseInt(delayInput.value) || DEFAULT_DELAY;
    if (delay < 1) delay = 1;
    if (delay > 30) delay = 30;
    delayInput.value = delay;
    
    // Validate limit value
    let limit = parseInt(limitInput.value) || DEFAULT_LIMIT;
    if (limit < 1) limit = DEFAULT_LIMIT;
    limitInput.value = limit;
    
    const settings = {
      delay: delay * 1000, // Convert to milliseconds
      limit: limit,
      whitelist: Array.from(whitelist)
    };
    
    console.log(`Starting unfriending with delay: ${delay} seconds, limit: ${limit}`);
    
    chrome.storage.sync.set(settings, () => {
      chrome.runtime.sendMessage({ action: 'startUnfriending', settings }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error starting unfriending:', chrome.runtime.lastError);
          lastError = chrome.runtime.lastError.message || 'Unknown error';
          updateUI();
          return;
        }
        
        if (response && response.status === 'started') {
          isProcessing = true;
          statusElement.textContent = `Started unfriending ${response.friendCount} friends (${response.processedToday}/${response.dailyLimit} today)`;
          statusElement.className = 'status success';
          updateUI();
          
          // Start checking for completion
          setTimeout(checkProcessCompletion, 5000);
        } else if (response && response.status === 'error') {
          lastError = response.message || 'Unknown error';
          updateUI();
        }
      });
    });
  });

  startUnfollowBtn.addEventListener('click', () => {
    // Validate delay value
    let delay = parseInt(delayInput.value) || DEFAULT_DELAY;
    if (delay < 1) delay = 1;
    if (delay > 30) delay = 30;
    delayInput.value = delay;
    
    // Validate limit value
    let limit = parseInt(limitInput.value) || DEFAULT_LIMIT;
    if (limit < 1) limit = DEFAULT_LIMIT;
    limitInput.value = limit;
    
    const settings = {
      delay: delay * 1000, // Convert to milliseconds
      limit: limit,
      whitelist: Array.from(whitelist)
    };
    
    console.log(`Starting unfollowing with delay: ${delay} seconds, limit: ${limit}`);
    
    chrome.storage.sync.set(settings, () => {
      chrome.runtime.sendMessage({ action: 'startUnfollowing', settings }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error starting unfollowing:', chrome.runtime.lastError);
          lastError = chrome.runtime.lastError.message || 'Unknown error';
          updateUI();
          return;
        }
        
        if (response && response.status === 'started') {
          isProcessing = true;
          statusElement.textContent = `Started unfollowing ${response.friendCount} friends (${response.processedToday}/${response.dailyLimit} today)`;
          statusElement.className = 'status success';
          updateUI();
          
          // Start checking for completion
          setTimeout(checkProcessCompletion, 5000);
        } else if (response && response.status === 'error') {
          lastError = response.message || 'Unknown error';
          updateUI();
        }
      });
    });
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopUnfriending' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error stopping process:', chrome.runtime.lastError);
        lastError = chrome.runtime.lastError.message || 'Unknown error';
        updateUI();
        return;
      }
      
      if (response && response.status === 'stopped') {
        isProcessing = false;
        statusElement.textContent = `Process stopped. Processed ${response.processedCount || 0} friends.`;
        statusElement.className = 'status';
        updateUI();
      }
    });
  });

  // Add event listener for reset button
  resetSettingsBtn.addEventListener('click', () => {
    resetToDefaults(true);
  });

  // Initialize
  loadFriends();
  updateUI();
}); 