// Global variables
let friendsCache = [];
let isScanning = false;
let isLoadingAll = false;
let loadingAllAborted = false;
let lastLoadedFriends = []; // Store the last loaded friends

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getFriends':
      if (friendsCache.length > 0) {
        sendResponse({ friends: friendsCache });
      } else {
        scanFriends().then(friends => {
          friendsCache = friends;
          sendResponse({ friends });
        }).catch(error => {
          console.error('Error scanning friends:', error);
          sendResponse({ friends: [], error: error.message });
        });
        return true; // Keep the message channel open for async response
      }
      break;
      
    case 'refreshFriends':
      friendsCache = [];
      scanFriends().then(friends => {
        friendsCache = friends;
        sendResponse({ friends });
      }).catch(error => {
        console.error('Error refreshing friends:', error);
        sendResponse({ friends: [], error: error.message });
      });
      return true; // Keep the message channel open for async response
      
    case 'loadAllFriends':
      if (isLoadingAll) {
        sendResponse({ error: 'Already loading all friends' });
        return;
      }
      
      loadAllFriends()
        .then(friends => {
          friendsCache = friends;
          sendResponse({ success: true, friends });
        })
        .catch(error => {
          console.error('Error loading all friends:', error);
          sendResponse({ error: error.message });
        });
      return true; // Keep the message channel open for async response
      
    case 'abortLoadingAll':
      console.log("Received abort request from popup");
      loadingAllAborted = true;
      
      // Immediately store any friends we've already loaded
      if (window.lastProgressUpdate && window.lastProgressUpdate.friends) {
        lastLoadedFriends = window.lastProgressUpdate.friends.map(friend => ({
          id: friend.id,
          name: friend.name
        }));
        console.log(`Stored ${lastLoadedFriends.length} friends from last progress update`);
      }
      
      // Send an immediate response to confirm the abort request was received
      sendResponse({ 
        success: true, 
        message: "Abort request received",
        friendsLoaded: lastLoadedFriends.length
      });
      
      // Also send a progress update to update the UI
      setTimeout(() => {
        if (isLoadingAll) {
          sendProgressUpdate(
            100, 
            "Loading aborted by user. Processing will stop after current operation completes.", 
            lastLoadedFriends, 
            true
          );
        } else {
          // If loading has already stopped, send a final update
          sendProgressUpdate(
            100, 
            `Loading stopped. Found ${lastLoadedFriends.length} friends.`, 
            lastLoadedFriends, 
            true
          );
        }
      }, 100);
      break;
      
    case 'unfriend':
      unfriendPerson(request.id)
        .then(result => sendResponse(result))
        .catch(error => {
          console.error('Error unfriending:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep the message channel open for async response
      
    case 'unfollow':
      unfollowPerson(request.id)
        .then(result => sendResponse(result))
        .catch(error => {
          console.error('Error unfollowing:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep the message channel open for async response
      
    case 'getLoadingStatus':
      sendResponse({
        isLoadingAll,
        lastProgressUpdate: window.lastProgressUpdate || null,
        lastLoadedFriends: lastLoadedFriends
      });
      break;
      
    case 'getLatestFriendsData':
      console.log(`Sending ${lastLoadedFriends.length} friends to popup`);
      sendResponse({
        friends: lastLoadedFriends,
        count: lastLoadedFriends.length
      });
      break;
  }
});

/**
 * Scan for friends on the current Facebook page
 * Updated to work with current Facebook DOM structure (2024)
 */
async function scanFriends() {
  // Check if we're on Facebook
  if (!window.location.href.includes('facebook.com')) {
    throw new Error('Please navigate to Facebook to use this extension');
  }
  
  if (isScanning) {
    throw new Error('Already scanning for friends');
  }
  
  isScanning = true;
  const friends = [];
  
  try {
    console.log("Starting to scan for friends...");
    
    // Try to find friends in the sidebar (new Facebook UI)
    const sidebarFriends = document.querySelectorAll('div[data-visualcompletion="ignore-dynamic"] a[role="link"]');
    
    if (sidebarFriends && sidebarFriends.length > 0) {
      console.log(`Found ${sidebarFriends.length} potential elements in sidebar`);
      
      // Facebook loads friends dynamically as you scroll
      // We'll scroll the sidebar to load more friends
      const sidebar = sidebarFriends[0].closest('div[role="navigation"]') || 
                     document.querySelector('div[role="navigation"]');
      
      if (sidebar) {
        for (let i = 0; i < 10; i++) {
          sidebar.scrollTop = sidebar.scrollHeight;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Re-query to get all loaded friends
        const allSidebarFriends = document.querySelectorAll('div[data-visualcompletion="ignore-dynamic"] a[role="link"]');
        
        // Filter out non-friend elements (like groups, events, etc.)
        for (const element of allSidebarFriends) {
          try {
            // Extract friend name
            const nameElement = element.querySelector('span[class*="x1lliihq"] span[class*="x193iq5w"]') || 
                               element.querySelector('span[dir="auto"]');
            
            if (!nameElement) continue;
            
            const name = nameElement.textContent.trim();
            
            // Skip elements that are likely not friends
            if (name.includes('group') || 
                name.includes('event') || 
                name.includes('reel') || 
                name.includes('stories') || 
                name.match(/^\d+[hm]$/) || // Time indicators like "2h", "4h", "23m"
                name.length < 3) {
              console.log(`Skipping non-friend element: ${name}`);
              continue;
            }
            
            // Extract friend ID from href
            const href = element.getAttribute('href') || '';
            
            // Skip elements with non-profile hrefs
            if (href.includes('/groups/') || 
                href.includes('/events/') || 
                href.includes('/reels/') || 
                href.includes('/stories/') ||
                href === '/' ||
                href.includes('/bookmarks/')) {
              console.log(`Skipping non-profile link: ${href}`);
              continue;
            }
            
            const idMatch = href.match(/\/profile\.php\?id=(\d+)/) || 
                           href.match(/facebook\.com\/([^/?]+)/);
            
            const id = idMatch ? idMatch[1] : generateTempId(name);
            
            friends.push({ id, name, element });
            console.log(`Found friend: ${name} (${id})`);
          } catch (err) {
            console.error('Error processing friend element:', err);
          }
        }
      }
    }
    
    // If we couldn't find friends in the sidebar, try the friends list page
    if (friends.length === 0 && window.location.href.includes('/friends')) {
      console.log("Trying to find friends in the friends list page");
      
      // Try to find friends in the main content area
      const friendElements = document.querySelectorAll('div[role="main"] div[role="article"]');
      
      if (friendElements && friendElements.length > 0) {
        console.log(`Found ${friendElements.length} friends in main content`);
        
        // Scroll to load more friends
        for (let i = 0; i < 5; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        for (const element of friendElements) {
          try {
            // Extract friend name
            const nameElement = element.querySelector('span[dir="auto"]') || 
                               element.querySelector('h2') || 
                               element.querySelector('h3');
            
            if (!nameElement) continue;
            
            const name = nameElement.textContent.trim();
            
            // Extract friend ID from href
            const linkElement = element.querySelector('a[href*="/friends/"]') || 
                               element.querySelector('a[href*="/profile.php"]') ||
                               element.querySelector('a[role="link"]');
            
            if (!linkElement) continue;
            
            const href = linkElement.getAttribute('href') || '';
            const idMatch = href.match(/\/profile\.php\?id=(\d+)/) || 
                           href.match(/facebook\.com\/([^/?]+)/);
            
            const id = idMatch ? idMatch[1] : generateTempId(name);
            
            friends.push({ id, name, element });
            console.log(`Found friend: ${name} (${id})`);
          } catch (err) {
            console.error('Error processing friend element:', err);
          }
        }
      }
    }
    
    if (friends.length === 0) {
      console.log("No friends found. Trying to navigate to friends page...");
      
      // Try to find the friends list page link
      const friendsPageLink = Array.from(document.querySelectorAll('a[href*="/friends"]'))
        .find(a => {
          const text = a.textContent.toLowerCase();
          return text.includes('friend') && !text.includes('request');
        });
      
      if (friendsPageLink) {
        console.log("Found friends page link, suggesting navigation");
        throw new Error('Please navigate to your friends list by clicking "Friends" in the sidebar or visit facebook.com/friends/list');
      } else {
        throw new Error('Could not find friends. Please navigate to your Facebook friends page manually.');
      }
    }
  } finally {
    isScanning = false;
  }
  
  console.log(`Scan complete. Found ${friends.length} friends.`);
  return friends;
}

/**
 * Generate a temporary ID for a friend when a real ID can't be extracted
 */
function generateTempId(name) {
  return 'temp_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.floor(Math.random() * 10000);
}

/**
 * Wait for an element to appear in the DOM
 * @param {string|string[]} selector - CSS selector or array of selectors to wait for
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<Element>} - The found element
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Convert single selector to array for consistent handling
    const selectors = Array.isArray(selector) ? selector : [selector];
    
    // Check if any of the selectors already exist
    for (const sel of selectors) {
      const element = document.querySelector(sel);
      if (element) {
        console.log(`Element found immediately: ${sel}`);
        return resolve(element);
      }
    }
    
    console.log(`Waiting for elements: ${selectors.join(', ')}`);
    
    // Set up mutation observer to watch for changes
    const observer = new MutationObserver(mutations => {
      for (const sel of selectors) {
        const element = document.querySelector(sel);
        if (element) {
          observer.disconnect();
          console.log(`Element appeared in DOM: ${sel}`);
          resolve(element);
          return;
        }
      }
    });
    
    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false
    });
    
    // Set timeout to avoid waiting forever
    setTimeout(() => {
      observer.disconnect();
      
      // One final check before rejecting
      for (const sel of selectors) {
        const element = document.querySelector(sel);
        if (element) {
          console.log(`Element found on final check: ${sel}`);
          return resolve(element);
        }
      }
      
      console.warn(`Timeout waiting for elements: ${selectors.join(', ')}`);
      // Resolve with null instead of rejecting to avoid breaking the flow
      resolve(null);
    }, timeout);
  });
}

/**
 * Unfriend a person by ID
 */
async function unfriendPerson(id) {
  try {
    console.log(`Attempting to unfriend person with ID: ${id}`);
    
    // Find the friend in our cache
    const friend = friendsCache.find(f => f.id === id);
    if (!friend) {
      console.error(`Friend not found in cache: ${id}`);
      return { success: false, error: 'Friend not found in cache' };
    }
    
    console.log(`Found friend in cache: ${friend.name}`);
    
    // Check if we're on the friends page
    const onFriendsPage = window.location.href.includes('/friends') || 
                         window.location.href.includes('/friends/list');
    
    // If we're not on the friends page, navigate there first
    if (!onFriendsPage) {
      console.log('Not on friends page, navigating there first');
      // Try to find and click the friends link in the sidebar
      const friendsLink = Array.from(document.querySelectorAll('a[href*="/friends"]'))
        .find(a => a.textContent.toLowerCase().includes('friend') && 
                  !a.textContent.toLowerCase().includes('request'));
      
      if (friendsLink) {
        console.log('Found friends link, clicking it');
        friendsLink.click();
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        // Direct navigation as fallback
        console.log('Could not find friends link, trying direct navigation');
        window.location.href = 'https://www.facebook.com/friends/list';
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Refresh the friends cache if needed
    if (friendsCache.length === 0) {
      console.log('Friends cache is empty, rescanning');
      friendsCache = await scanFriends();
      
      // Try to find the friend again
      const refreshedFriend = friendsCache.find(f => f.id === id);
      if (!refreshedFriend) {
        console.error(`Friend still not found after refresh: ${id}`);
        return { success: false, error: 'Friend not found after refresh' };
      }
      friend = refreshedFriend;
    }
    
    // Method 1: Try unfriending directly from the friends list page
    if (onFriendsPage || window.location.href.includes('/friends')) {
      console.log('Using friends list page method');
      
      // Try to find the friend element on the page
      let friendElement = friend.element;
      
      // If the element is not valid or not in the DOM, try to find it again
      if (!friendElement || !document.body.contains(friendElement)) {
        console.log('Friend element not found in DOM, searching for it');
        
        // Try to find the friend by name in the current page
        const possibleElements = Array.from(document.querySelectorAll('div[role="article"]'))
          .filter(el => el.textContent.includes(friend.name));
        
        if (possibleElements.length > 0) {
          console.log(`Found ${possibleElements.length} possible elements for ${friend.name}`);
          friendElement = possibleElements[0];
          // Update the element in the cache
          friend.element = friendElement;
        } else {
          console.log('Could not find friend element on page, trying profile method');
          // Fall back to profile method
          return await unfriendViaProfile(friend);
        }
      }
      
      // Scroll the friend element into view
      console.log('Scrolling friend element into view');
      friendElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Find the "More" button for this friend
      const moreButton = findMoreButton(friendElement);
      
      if (!moreButton) {
        console.error('Could not find More button');
        // Fall back to profile method
        return await unfriendViaProfile(friend);
      }
      
      console.log('Found More button, clicking it');
      moreButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 500));
      moreButton.click();
      
      // Wait for the dropdown menu to appear
      const menu = await waitForElement('div[role="menu"]', 5000);
      if (!menu) {
        console.error('Menu did not appear after clicking More button');
        // Fall back to profile method
        return await unfriendViaProfile(friend);
      }
      
      // Find the "Unfriend" option
      const unfriendOption = findUnfriendOption();
      
      if (!unfriendOption) {
        // Close the menu by clicking elsewhere
        document.body.click();
        console.error('Could not find Unfriend option in menu');
        // Fall back to profile method
        return await unfriendViaProfile(friend);
      }
      
      console.log('Found Unfriend option, clicking it');
      unfriendOption.click();
      
      // Wait for confirmation dialog
      const dialog = await waitForElement('div[role="dialog"]', 5000);
      if (!dialog) {
        console.error('Confirmation dialog did not appear');
        // Fall back to profile method
        return await unfriendViaProfile(friend);
      }
      
      // Find and click the confirm button
      const confirmButton = findConfirmButton();
      
      if (!confirmButton) {
        console.error('Could not find confirmation button');
        // Try clicking any button in the dialog as a fallback
        const anyButton = dialog.querySelector('div[role="button"]');
        if (anyButton) {
          console.log('Found a button in dialog, clicking it');
          anyButton.click();
        } else {
          return { success: false, error: 'Could not find confirmation button' };
        }
      } else {
        console.log('Found confirmation button, clicking it');
        confirmButton.click();
      }
      
      // Wait for the action to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Remove from cache
      friendsCache = friendsCache.filter(f => f.id !== id);
      
      console.log(`Successfully unfriended ${friend.name}`);
      return { success: true, name: friend.name };
    } else {
      // Method 2: Unfriend via profile
      return await unfriendViaProfile(friend);
    }
  } catch (error) {
    console.error('Error in unfriendPerson:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to unfriend via profile page
 */
async function unfriendViaProfile(friend) {
  try {
    console.log(`Navigating to ${friend.name}'s profile`);
    
    // Construct the profile URL
    let profileUrl;
    if (friend.id.startsWith('temp_')) {
      // For temp IDs, try to find the profile URL from the element
      const linkElement = friend.element?.querySelector('a[href*="/profile.php"]') || 
                         friend.element?.querySelector('a[role="link"]');
      
      if (linkElement) {
        profileUrl = linkElement.getAttribute('href');
      } else {
        return { success: false, error: 'Could not determine profile URL for temp ID' };
      }
    } else if (friend.id.match(/^\d+$/)) {
      // Numeric ID
      profileUrl = `https://www.facebook.com/profile.php?id=${friend.id}`;
    } else {
      // Username
      profileUrl = `https://www.facebook.com/${friend.id}`;
    }
    
    // Navigate to the profile
    console.log(`Navigating to profile URL: ${profileUrl}`);
    window.location.href = profileUrl;
    
    // Wait for profile page to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Look for the Friends button on the profile
    const friendsButton = findFriendsButton();
    
    if (!friendsButton) {
      console.error('Could not find Friends button on profile');
      // Try an alternative approach
      const alternativeButton = findAlternativeFriendsButton();
      
      if (!alternativeButton) {
        return { success: false, error: 'Could not find Friends button on profile' };
      }
      
      console.log('Found alternative Friends button, clicking it');
      alternativeButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 500));
      alternativeButton.click();
    } else {
      console.log('Found Friends button, clicking it');
      friendsButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 500));
      friendsButton.click();
    }
    
    // Wait for the dropdown menu to appear
    const menu = await waitForElement('div[role="menu"]', 5000);
    if (!menu) {
      console.error('Menu did not appear after clicking Friends button');
      return { success: false, error: 'Menu did not appear' };
    }
    
    // Find the "Unfriend" option
    const unfriendOption = findUnfriendOption();
    
    if (!unfriendOption) {
      // Close the menu by clicking elsewhere
      document.body.click();
      console.error('Could not find Unfriend option in menu');
      return { success: false, error: 'Could not find Unfriend option' };
    }
    
    console.log('Found Unfriend option, clicking it');
    unfriendOption.click();
    
    // Wait for confirmation dialog
    const dialog = await waitForElement('div[role="dialog"]', 5000);
    if (!dialog) {
      console.error('Confirmation dialog did not appear');
      return { success: false, error: 'Confirmation dialog did not appear' };
    }
    
    // Find and click the confirm button
    const confirmButton = findConfirmButton();
    
    if (!confirmButton) {
      console.error('Could not find confirmation button');
      // Try clicking any button in the dialog as a fallback
      const anyButton = dialog.querySelector('div[role="button"]');
      if (anyButton) {
        console.log('Found a button in dialog, clicking it');
        anyButton.click();
      } else {
        return { success: false, error: 'Could not find confirmation button' };
      }
    } else {
      console.log('Found confirmation button, clicking it');
      confirmButton.click();
    }
    
    // Wait for the action to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Remove from cache
    friendsCache = friendsCache.filter(f => f.id !== friend.id);
    
    console.log(`Successfully unfriended ${friend.name}`);
    return { success: true, name: friend.name };
  } catch (error) {
    console.error('Error in unfriendViaProfile:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to find the Friends button on a profile
 */
function findFriendsButton() {
  console.log('Looking for Friends button on profile...');
  
  // Try multiple selectors to find the Friends button
  const possibleButtons = [
    // Standard Friends button
    ...Array.from(document.querySelectorAll('div[role="button"]'))
      .filter(btn => {
        const ariaLabel = btn.getAttribute('aria-label');
        return ariaLabel && (ariaLabel.includes('Friends') || ariaLabel === 'Friends');
      }),
    
    // Text-based search for buttons
    ...Array.from(document.querySelectorAll('div[role="button"]'))
      .filter(btn => btn.textContent.includes('Friends')),
    
    // Look for specific class patterns that might indicate the Friends button
    ...Array.from(document.querySelectorAll('div[aria-haspopup="menu"]')),
    
    // Look for any button near the profile header
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileActions"] div[role="button"]')),
    
    // New Facebook UI - look for buttons in the profile header
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileTabs"] div[role="button"]')),
    
    // Try to find buttons with specific icons
    ...Array.from(document.querySelectorAll('div[role="button"] svg'))
      .map(svg => svg.closest('div[role="button"]')),
      
    // Look for buttons in the profile actions section
    ...Array.from(document.querySelectorAll('div[role="main"] div[role="button"]')),
    
    // Look for buttons with specific text patterns
    ...Array.from(document.querySelectorAll('div[role="button"]'))
      .filter(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('friend') || text.includes('follow');
      }),
      
    // Look for buttons in the cover photo area
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileCoverPhoto"] div[role="button"]')),
    
    // Look for any element that might be clickable and related to friends
    ...Array.from(document.querySelectorAll('a[href*="friends"]')),
    ...Array.from(document.querySelectorAll('span'))
      .filter(span => span.textContent.includes('Friends'))
      .map(span => span.closest('div[role="button"]') || span.closest('a') || span)
  ];
  
  // Filter out null values and duplicates
  const uniqueButtons = [...new Set(possibleButtons.filter(btn => btn !== null))];
  
  // Log what we found for debugging
  console.log(`Found ${uniqueButtons.length} possible Friends buttons`);
  
  // Log the text content of each button for debugging
  uniqueButtons.forEach((btn, index) => {
    console.log(`Button ${index + 1}: "${btn.textContent.trim()}" with aria-label="${btn.getAttribute('aria-label') || 'none'}"`);
  });
  
  // Return the first valid button
  return uniqueButtons.length > 0 ? uniqueButtons[0] : null;
}

/**
 * Helper function to find alternative buttons that might be the Friends menu
 */
function findAlternativeFriendsButton() {
  // Look for any button that might be a menu or action button
  const possibleButtons = [
    // Look for buttons with dropdown menus
    ...Array.from(document.querySelectorAll('div[aria-haspopup="menu"]')),
    
    // Look for buttons with specific icons
    ...Array.from(document.querySelectorAll('div[role="button"] i[data-visualcompletion="css-img"]'))
      .map(icon => icon.closest('div[role="button"]')),
    
    // Look for any button in the profile actions area
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileActions"] div[role="button"]')),
    
    // Look for any button in the profile header
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileHeader"] div[role="button"]')),
    
    // New Facebook UI - look for buttons in the profile tabs
    ...Array.from(document.querySelectorAll('div[data-pagelet="ProfileTabs"] div[role="button"]'))
  ];
  
  console.log(`Found ${possibleButtons.length} possible alternative buttons`);
  
  // Return the first valid button
  return possibleButtons.find(btn => btn !== null);
}

/**
 * Helper function to find the More button for a friend element
 */
function findMoreButton(friendElement) {
  if (!friendElement) return null;
  
  // Try multiple selectors to find the More button
  return (
    // Standard More button
    friendElement.querySelector('[aria-label="Friends"]') || 
    friendElement.querySelector('[aria-label="More"]') ||
    friendElement.querySelector('div[aria-label="More"]') ||
    
    // Icon-based buttons
    friendElement.querySelector('i[data-visualcompletion="css-img"]')?.closest('div[role="button"]') ||
    
    // Any button that might be a menu
    friendElement.querySelector('div[aria-haspopup="menu"]') ||
    
    // Any button in the friend element
    friendElement.querySelector('div[role="button"]')
  );
}

/**
 * Helper function to find the Unfriend option in a menu
 */
function findUnfriendOption() {
  // Try multiple selectors to find the Unfriend option
  const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
  
  // Log what we found for debugging
  console.log(`Found ${menuItems.length} menu items`);
  
  return menuItems.find(item => {
    const text = item.textContent.toLowerCase();
    return (
      text.includes('unfriend') || 
      (text.includes('remove') && text.includes('friend')) ||
      text.includes('remove friend') ||
      text.includes('delete friend')
    );
  });
}

/**
 * Helper function to find the Confirm button in a dialog
 */
function findConfirmButton() {
  // Try multiple selectors to find the Confirm button
  const dialogButtons = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"]'));
  
  // Log what we found for debugging
  console.log(`Found ${dialogButtons.length} dialog buttons`);
  
  return dialogButtons.find(button => {
    const text = button.textContent.toLowerCase();
    return (
      text.includes('confirm') || 
      text.includes('remove') || 
      text.includes('unfriend') ||
      text.includes('ok') ||
      text.includes('yes')
    );
  });
}

/**
 * Unfollow a person by ID
 */
async function unfollowPerson(id) {
  try {
    console.log(`Attempting to unfollow person with ID: ${id}`);
    
    // Find the friend in our cache
    const friend = friendsCache.find(f => f.id === id);
    if (!friend) {
      console.error(`Friend not found in cache: ${id}`);
      return { success: false, error: 'Friend not found in cache' };
    }
    
    console.log(`Found friend in cache: ${friend.name}`);
    
    // For sidebar friends
    if (friend.element.closest('div[role="navigation"]')) {
      // Click on the friend to go to their profile
      console.log(`Navigating to ${friend.name}'s profile`);
      friend.element.click();
      
      // Wait for profile page to load - increased wait time
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Look for the Friends button on the profile - expanded selectors
      const friendsButton = findFriendsButton();
      
      if (!friendsButton) {
        console.error('Could not find Friends button on profile');
        // Try an alternative approach - look for any button that might be the friends menu
        const alternativeButton = findAlternativeFriendsButton();
        
        if (!alternativeButton) {
          return { success: false, error: 'Could not find Friends button on profile' };
        }
        
        console.log('Found alternative Friends button, clicking it');
        alternativeButton.click();
      } else {
        console.log('Found Friends button, clicking it');
        friendsButton.click();
      }
      
      // Wait for the dropdown menu to appear
      await waitForElement('div[role="menu"]', 5000);
      
      // Find the "Following" or "Unfollow" option
      const unfollowOption = findUnfollowOption();
      
      if (!unfollowOption) {
        // Close the menu by clicking elsewhere
        document.body.click();
        console.error('Could not find Following/Unfollow option in menu');
        return { success: false, error: 'Could not find Following/Unfollow option' };
      }
      
      console.log('Found Following/Unfollow option, clicking it');
      unfollowOption.click();
      
      // Wait for any confirmation dialog (might not appear for unfollow)
      try {
        const dialog = await waitForElement('div[role="dialog"]', 3000);
        if (dialog) {
          // Find and click the confirm button
          const confirmButton = findConfirmButton();
          
          if (confirmButton) {
            console.log('Found confirmation button, clicking it');
            confirmButton.click();
          }
        }
      } catch (e) {
        // It's okay if there's no dialog for unfollow
        console.log('No confirmation dialog found, continuing');
      }
      
      // Wait for the action to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } else {
      // For friends in the main content area or friends list
      
      // Find the menu button for this friend
      const menuButton = findMoreButton(friend.element);
      
      if (!menuButton) {
        console.error('Could not find menu button');
        return { success: false, error: 'Could not find menu button' };
      }
      
      console.log('Found menu button, clicking it');
      menuButton.click();
      
      // Wait for the dropdown menu to appear
      await waitForElement('div[role="menu"]', 5000);
      
      // Find the "Following" or "Unfollow" option
      const unfollowOption = findUnfollowOption();
      
      if (!unfollowOption) {
        // Close the menu by clicking elsewhere
        document.body.click();
        console.error('Could not find Following/Unfollow option in menu');
        return { success: false, error: 'Could not find Following/Unfollow option' };
      }
      
      console.log('Found Following/Unfollow option, clicking it');
      unfollowOption.click();
      
      // Wait for any confirmation dialog (might not appear for unfollow)
      try {
        const dialog = await waitForElement('div[role="dialog"]', 3000);
        if (dialog) {
          // Find and click the confirm button
          const confirmButton = findConfirmButton();
          
          if (confirmButton) {
            console.log('Found confirmation button, clicking it');
            confirmButton.click();
          }
        }
      } catch (e) {
        // It's okay if there's no dialog for unfollow
        console.log('No confirmation dialog found, continuing');
      }
      
      // Wait for the action to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`Successfully unfollowed ${friend.name}`);
    return { success: true, name: friend.name };
  } catch (error) {
    console.error('Error in unfollowPerson:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to find the Following/Unfollow option in a menu
 */
function findUnfollowOption() {
  // Try multiple selectors to find the Following/Unfollow option
  const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
  
  // Log what we found for debugging
  console.log(`Found ${menuItems.length} menu items for unfollow`);
  
  return menuItems.find(item => {
    const text = item.textContent.toLowerCase();
    return (
      text.includes('following') || 
      text.includes('unfollow') || 
      text.includes('follow') ||
      text.includes('news feed') ||
      text.includes('updates')
    );
  });
}

/**
 * Load all friends by auto-scrolling the sidebar or friends list
 */
async function loadAllFriends() {
  if (isLoadingAll) {
    throw new Error('Already loading all friends');
  }
  
  isLoadingAll = true;
  loadingAllAborted = false;
  const friends = [];
  let lastFriendCount = 0;
  let noNewFriendsCount = 0;
  let MAX_NO_NEW_FRIENDS = 5; // Changed from const to let so it can be modified later
  let lastScrollHeight = 0;
  let stuckScrollCount = 0;
  const MAX_STUCK_SCROLL = 3; // Try alternative scrolling after this many stuck attempts
  let userDailyLimit = 75; // Default to a lower limit
  
  try {
    // Get the user's daily limit setting
    const limitData = await new Promise(resolve => {
      chrome.storage.sync.get(['limit'], (data) => {
        resolve(data);
      });
    });
    
    if (limitData && limitData.limit) {
      userDailyLimit = parseInt(limitData.limit);
      console.log(`Using user's daily limit setting: ${userDailyLimit}`);
    }
    
    console.log("Starting to load all friends...");
    
    // Determine if we're on the friends list page or using the sidebar
    const isFriendsListPage = window.location.href.includes('/friends/list') || 
                             window.location.href.includes('/friends') ||
                             window.location.href.includes('/friends_all');
    
    // Find the container to scroll - using the exact XPath provided by the user
    let container = null;
    let friendsContainer = null;
    let mainScrollableContainer = null;
    
    // Try the exact XPath from the user's message
    try {
      // First try the container that holds the friends list
      const containerXPath = "/html/body/div[1]/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div[1]/div/div[2]/div[1]/div[2]/div";
      const containerResult = document.evaluate(containerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      container = containerResult.singleNodeValue;
      
      // Then try to find the container with the actual profile elements
      const friendsContainerXPath = "/html/body/div[1]/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div[1]/div/div[2]/div[1]/div[2]/div/div[4]";
      const friendsContainerResult = document.evaluate(friendsContainerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      friendsContainer = friendsContainerResult.singleNodeValue;
      
      console.log("Found container using XPath:", container);
      console.log("Found friends container using XPath:", friendsContainer);
    } catch (e) {
      console.error("Error using XPath:", e);
    }
    
    // If XPath didn't work, try CSS selectors
    if (!container) {
      // Try to find the container by class name
      container = document.querySelector('div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.x1l7klhg.x1iyjqo2.xs83m0k.x2lwn1j.xx8ngbg.xwo3gff.x1oyok0e.x1odjw0f.x1e4zzel.x1n2onr6.xq1qtft') ||
                 document.querySelector('div.x135pmgq');
      
      console.log("Found container using class selector:", container);
    }
    
    // Find the main scrollable container (usually the one with overflow: auto or scroll)
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const style = window.getComputedStyle(div);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && 
          div.scrollHeight > 500 && 
          div.clientHeight > 300) {
        mainScrollableContainer = div;
        console.log("Found main scrollable container:", mainScrollableContainer);
        break;
      }
    }
    
    // If still no container, try more generic approaches
    if (!container) {
      // Try to find any scrollable container
      const possibleContainers = Array.from(document.querySelectorAll('div[role="main"] div'));
      container = possibleContainers.find(el => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > 300;
      });
      
      if (!container) {
        // Last resort: use the main content area
        container = document.querySelector('div[role="main"]') || document;
      }
    }
    
    if (!container) {
      throw new Error('Could not find scrollable container');
    }
    
    console.log("Final container selected:", container);
    
    // Initial progress update
    sendProgressUpdate(0, 'Starting to load friends...', []);
    
    // Auto-scroll to load all friends
    let progress = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = 100; // Increased maximum scroll attempts
    
    // Function to check if we should continue loading
    const shouldContinueLoading = () => {
      // Check if we've reached the user's daily limit
      if (friends.length >= userDailyLimit) {
        console.log(`Reached user's daily limit of ${userDailyLimit} friends. Stopping.`);
        return false;
      }
      
      // Check if loading was aborted
      if (loadingAllAborted) {
        console.log("Loading aborted by user");
        return false;
      }
      
      // Check if we've reached the maximum scroll attempts
      if (scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
        console.log(`Reached maximum scroll attempts (${MAX_SCROLL_ATTEMPTS}). Stopping.`);
        return false;
      }
      
      // Check if we've had too many attempts with no new friends
      if (noNewFriendsCount >= MAX_NO_NEW_FRIENDS) {
        console.log(`No new friends found after ${MAX_NO_NEW_FRIENDS} attempts. Stopping.`);
        return false;
      }
      
      return true;
    };
    
    while (shouldContinueLoading()) {
      // Scroll the container
      try {
        // Get current scroll height before scrolling
        const currentScrollHeight = container.scrollHeight;
        console.log(`Current scroll height: ${currentScrollHeight}, Last scroll height: ${lastScrollHeight}`);
        
        // Check if we're stuck (scroll height not changing)
        if (currentScrollHeight === lastScrollHeight) {
          stuckScrollCount++;
          console.log(`Scroll appears stuck. Stuck count: ${stuckScrollCount}`);
        } else {
          stuckScrollCount = 0;
        }
        
        // Try multiple scrolling methods
        if (container === document) {
          // Document scrolling
          window.scrollTo(0, document.body.scrollHeight);
          console.log("Scrolled document to bottom");
        } else if (stuckScrollCount >= MAX_STUCK_SCROLL) {
          // If we're stuck, try alternative scrolling methods
          console.log("Using alternative scrolling methods due to stuck scrolling");
          
          // Method 1: Try scrolling the main scrollable container if found
          if (mainScrollableContainer) {
            mainScrollableContainer.scrollTop = mainScrollableContainer.scrollHeight;
            console.log("Scrolled main scrollable container");
          }
          
          // Method 2: Try scrolling the window
          window.scrollTo(0, document.body.scrollHeight);
          console.log("Scrolled window as fallback");
          
          // Method 3: Try clicking "See More" buttons if present
          const seeMoreButtons = document.querySelectorAll('div[role="button"]:not([aria-hidden="true"])');
          for (const button of seeMoreButtons) {
            if (button.textContent.toLowerCase().includes('see more') || 
                button.textContent.toLowerCase().includes('show more')) {
              console.log("Clicking 'See More' button:", button);
              button.click();
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // Method 4: Try to find and click any "Load more" links
          const loadMoreLinks = Array.from(document.querySelectorAll('a[role="link"]')).filter(
            link => link.textContent.toLowerCase().includes('load more') || 
                   link.textContent.toLowerCase().includes('see more')
          );
          
          for (const link of loadMoreLinks) {
            console.log("Clicking 'Load More' link:", link);
            link.click();
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Method 5: Try to inject scroll events directly
          const scrollEvent = new Event('scroll');
          document.dispatchEvent(scrollEvent);
          container.dispatchEvent(scrollEvent);
          if (mainScrollableContainer) {
            mainScrollableContainer.dispatchEvent(scrollEvent);
          }
          
          // Method 6: Try to use JavaScript to modify the container's height to force loading
          if (friendsContainer) {
            const originalHeight = friendsContainer.style.height;
            friendsContainer.style.height = (parseInt(window.getComputedStyle(friendsContainer).height) + 1000) + 'px';
            await new Promise(resolve => setTimeout(resolve, 500));
            friendsContainer.style.height = originalHeight;
          }
        } else {
          // Standard scrolling methods
          // Method 1: Standard scrollTop
          container.scrollTop = container.scrollHeight;
          
          // Method 2: Use scrollIntoView on the last child
          if (container.lastElementChild) {
            container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
          
          // Method 3: Use scrollBy
          container.scrollBy(0, 1000);
          
          // Method 4: Simulate mouse wheel event
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 2000,
            bubbles: true
          }));
          
          console.log("Scrolled container, current scrollTop:", container.scrollTop, "scrollHeight:", container.scrollHeight);
        }
        
        // Save the current scroll height for next comparison
        lastScrollHeight = currentScrollHeight;
      } catch (e) {
        console.error("Error during scrolling:", e);
        // Fallback to window scroll
        window.scrollTo(0, document.body.scrollHeight);
      }
      
      // Check again if we should continue
      if (!shouldContinueLoading()) {
        break;
      }
      
      // Wait for new content to load - longer wait time
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Scan for friends using the specific container if available
      const newFriends = await scanVisibleFriends(isFriendsListPage, friendsContainer || container);
      
      // Add new friends to the list (avoiding duplicates) up to the daily limit
      let addedNewFriends = false;
      for (const friend of newFriends) {
        // Stop adding friends if we've reached the limit
        if (friends.length >= userDailyLimit) {
          console.log(`Reached daily limit of ${userDailyLimit}. Stopping friend collection.`);
          break;
        }
        
        if (!friends.some(f => f.id === friend.id)) {
          friends.push(friend);
          addedNewFriends = true;
        }
      }
      
      // Check if we found new friends
      if (friends.length > lastFriendCount) {
        lastFriendCount = friends.length;
        noNewFriendsCount = 0;
        console.log(`Found new friends! Total now: ${friends.length}/${userDailyLimit}`);
      } else {
        noNewFriendsCount++;
        console.log(`No new friends found. Attempt ${noNewFriendsCount}/${MAX_NO_NEW_FRIENDS}`);
      }
      
      // Update progress
      scrollAttempts++;
      progress = Math.min(100, Math.round((scrollAttempts / MAX_SCROLL_ATTEMPTS) * 100));
      
      // Calculate progress based on daily limit if we have friends
      if (friends.length > 0) {
        const limitProgress = Math.min(100, Math.round((friends.length / userDailyLimit) * 100));
        // Use the higher of the two progress values
        progress = Math.max(progress, limitProgress);
      }
      
      sendProgressUpdate(
        progress, 
        `Loaded ${friends.length}/${userDailyLimit} friends (scroll attempt ${scrollAttempts}/${MAX_SCROLL_ATTEMPTS})...`, 
        friends
      );
      
      // If we've found a significant number of friends, increase the MAX_NO_NEW_FRIENDS threshold
      // This helps prevent premature termination when loading large friend lists
      if (friends.length > 500) {
        MAX_NO_NEW_FRIENDS = 10; // More attempts for large friend lists
      }
      
      // Check again if we should continue
      if (!shouldContinueLoading()) {
        break;
      }
    }
    
    // Final progress update
    if (loadingAllAborted) {
      sendProgressUpdate(100, `Loading aborted. Found ${friends.length} friends.`, friends, true);
    } else if (friends.length >= userDailyLimit) {
      sendProgressUpdate(100, `Reached daily limit of ${userDailyLimit}. Found ${friends.length} friends.`, friends, true);
    } else if (noNewFriendsCount >= MAX_NO_NEW_FRIENDS) {
      sendProgressUpdate(100, `Completed! Found ${friends.length} friends.`, friends, true);
    } else {
      sendProgressUpdate(100, `Reached maximum scroll attempts. Found ${friends.length} friends.`, friends, true);
    }
    
    // Store the loaded friends for later retrieval
    lastLoadedFriends = friends.map(friend => ({
      id: friend.id,
      name: friend.name
    }));
    
    console.log(`Load all friends complete. Found ${friends.length}/${userDailyLimit} friends.`);
    return friends;
  } catch (error) {
    console.error('Error in loadAllFriends:', error);
    sendProgressUpdate(100, `Error: ${error.message}`, friends, true);
    throw error;
  } finally {
    isLoadingAll = false;
  }
}

/**
 * Send progress update to the popup
 */
function sendProgressUpdate(progress, message, friends, done = false) {
  try {
    // Clean up the friends array to avoid circular references
    const cleanFriends = friends.map(friend => ({
      id: friend.id,
      name: friend.name
      // Exclude the element property which can cause circular references
    }));
    
    console.log(`Sending progress update: ${progress}%, ${message}, ${cleanFriends.length} friends`);
    
    // Store the progress update locally in case the message port closes
    window.lastProgressUpdate = {
      progress,
      message,
      friendsCount: cleanFriends.length,
      done
    };
    
    // For large friend lists, we need to chunk the data to avoid message size limits
    const MAX_FRIENDS_PER_MESSAGE = 500;
    
    if (cleanFriends.length > MAX_FRIENDS_PER_MESSAGE && !done) {
      // For in-progress updates with large friend lists, just send the count
      // We'll send the full list only on completion
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({
            action: 'loadAllFriendsProgress',
            progress,
            message,
            friendsCount: cleanFriends.length,
            friends: [], // Empty array to save bandwidth
            done: false
          }, response => {
            if (chrome.runtime.lastError) {
              console.log('Note: Message port closed, this is expected behavior when popup is closed');
            }
          });
        } catch (innerError) {
          console.log('Could not send progress update, popup may be closed');
        }
      }, 0);
    } else if (cleanFriends.length > MAX_FRIENDS_PER_MESSAGE && done) {
      // For the final update with large friend lists, send in chunks
      const chunks = [];
      for (let i = 0; i < cleanFriends.length; i += MAX_FRIENDS_PER_MESSAGE) {
        chunks.push(cleanFriends.slice(i, i + MAX_FRIENDS_PER_MESSAGE));
      }
      
      console.log(`Splitting ${cleanFriends.length} friends into ${chunks.length} chunks for sending`);
      
      // Send each chunk with a small delay to avoid overwhelming the message channel
      chunks.forEach((chunk, index) => {
        setTimeout(() => {
          try {
            const isLastChunk = index === chunks.length - 1;
            chrome.runtime.sendMessage({
              action: 'loadAllFriendsProgress',
              progress: isLastChunk ? progress : Math.min(99, progress), // Only mark as 100% on last chunk
              message: isLastChunk ? message : `${message} (sending chunk ${index + 1}/${chunks.length})`,
              friendsCount: cleanFriends.length,
              friends: chunk,
              chunkIndex: index,
              totalChunks: chunks.length,
              done: isLastChunk ? done : false
            }, response => {
              if (chrome.runtime.lastError) {
                console.log('Note: Message port closed during chunk send');
              }
            });
          } catch (chunkError) {
            console.log(`Could not send chunk ${index + 1}/${chunks.length}`);
          }
        }, index * 200); // 200ms delay between chunks
      });
    } else {
      // For small friend lists or non-final updates, send normally
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({
            action: 'loadAllFriendsProgress',
            progress,
            message,
            friends: cleanFriends,
            friendsCount: cleanFriends.length,
            done
          }, response => {
            // We expect the port to close sometimes, so just log it without treating as an error
            if (chrome.runtime.lastError) {
              console.log('Note: Message port closed, this is expected behavior when popup is closed');
            }
          });
        } catch (innerError) {
          console.log('Could not send progress update, popup may be closed');
        }
      }, 0);
    }
  } catch (error) {
    console.error('Error in sendProgressUpdate:', error);
  }
}

/**
 * Scan for visible friends on the current page
 */
async function scanVisibleFriends(isFriendsListPage, container) {
  const friends = [];
  
  try {
    console.log("Scanning for friends in container:", container);
    
    // First, try to find all friend elements in the entire document
    // This is a more aggressive approach to ensure we don't miss any friends
    const allPossibleFriendElements = [];
    
    // 1. Look for elements with data-visualcompletion="ignore-dynamic"
    const ignoreElements = document.querySelectorAll('div[data-visualcompletion="ignore-dynamic"]');
    if (ignoreElements.length > 0) {
      console.log(`Found ${ignoreElements.length} elements with data-visualcompletion="ignore-dynamic" in document`);
      allPossibleFriendElements.push(...ignoreElements);
    }
    
    // 2. Look for all anchor elements that might be friends
    const allAnchors = document.querySelectorAll('a[role="link"]');
    allPossibleFriendElements.push(...allAnchors);
    
    // 3. Look for all article elements that might contain friends
    const allArticles = document.querySelectorAll('div[role="article"]');
    allPossibleFriendElements.push(...allArticles);
    
    console.log(`Found ${allPossibleFriendElements.length} total possible friend elements in document`);
    
    // Now look in the specific container if provided
    if (container) {
      // Friends list page - try multiple selectors
      let friendElements = [];
      
      // First try to find elements with data-visualcompletion="ignore-dynamic" attribute
      // This is based on the user's specific element structure
      const containerIgnoreElements = container.querySelectorAll('div[data-visualcompletion="ignore-dynamic"]');
      if (containerIgnoreElements.length > 0) {
        console.log(`Found ${containerIgnoreElements.length} elements with data-visualcompletion="ignore-dynamic" in container`);
        friendElements = [...containerIgnoreElements];
      }
      
      // If no elements found, try different selectors
      if (friendElements.length === 0) {
        const selectors = [
          'a[role="link"]',
          'div[role="article"]',
          'div.x1lliihq a[role="link"]',
          'div[data-pagelet="ProfileAppSection_0"] div[role="article"]',
          'div[data-pagelet="ProfileAppSection_0"] a[role="link"]'
        ];
        
        for (const selector of selectors) {
          const elements = container.querySelectorAll(selector);
          if (elements.length > 0) {
            friendElements = [...elements];
            console.log(`Found ${friendElements.length} friend elements using selector: ${selector} in container`);
            break;
          }
        }
      }
      
      // If still no elements found, try a more generic approach
      if (friendElements.length === 0) {
        // Look for elements that might contain friend information
        const potentialContainers = container.querySelectorAll('div');
        
        for (const potentialContainer of potentialContainers) {
          // Check if this container has link elements and name elements
          const links = potentialContainer.querySelectorAll('a[role="link"]');
          const nameElements = potentialContainer.querySelectorAll('span[dir="auto"]');
          
          if (links.length > 0 && nameElements.length > 0) {
            friendElements = [...links];
            console.log(`Found ${friendElements.length} potential friend elements using generic approach in container`);
            break;
          }
        }
      }
      
      // Add container-specific elements to our list
      if (friendElements.length > 0) {
        allPossibleFriendElements.push(...friendElements);
        console.log(`Added ${friendElements.length} container-specific elements to our search list`);
      }
    }
    
    // Process all potential friend elements
    console.log(`Processing ${allPossibleFriendElements.length} potential friend elements`);
    
    // Create a Set to track processed elements and avoid duplicates
    const processedElements = new Set();
    
    for (const element of allPossibleFriendElements) {
      // Skip if we've already processed this element
      if (processedElements.has(element)) continue;
      processedElements.add(element);
      
      try {
        // Extract friend name - try multiple selectors
        const nameSelectors = [
          'span[dir="auto"]',
          'h2',
          'h3',
          'span[class*="x1lliihq"] span[class*="x193iq5w"]',
          'span.x1lliihq',
          'div.x1rg5ohu',
          'strong',
          'div.x9f619 div.x1lliihq',
          'div.x9f619 span',
          'div.xu06os2 span',
          'div.x1qjc9v5 span',
          'span.xt0psk2',
          'span.x193iq5w',
          'div.x1lliihq'
        ];
        
        let nameElement = null;
        for (const selector of nameSelectors) {
          nameElement = element.querySelector(selector);
          if (nameElement) break;
        }
        
        // If no name element found with selectors, check if the element itself has text
        if (!nameElement && element.textContent && element.textContent.trim().length > 0) {
          nameElement = element;
        }
        
        // If still no name element, try to find any text content
        if (!nameElement) {
          // Try to find any text content that might be a name
          const textNodes = Array.from(element.querySelectorAll('*')).filter(el => 
            el.textContent && 
            el.textContent.trim().length > 0 && 
            el.children.length === 0
          );
          
          if (textNodes.length > 0) {
            nameElement = textNodes[0];
          } else {
            continue;
          }
        }
        
        const name = nameElement.textContent.trim();
        
        // Skip elements that are likely not friends
        if (name.includes('group') || 
            name.includes('Group') ||
            name.includes('event') || 
            name.includes('Event') ||
            name.includes('reel') || 
            name.includes('Reel') ||
            name.includes('story') || 
            name.includes('Story') ||
            name.includes('stories') || 
            name.includes('Stories') ||
            name.includes('Page') ||
            name.includes('page') ||
            name.includes('Messenger') ||
            name.includes('Gaming') ||
            name.includes('Watch') ||
            name.includes('Marketplace') ||
            name.includes('News') ||
            name.match(/^\d+[hm]$/) || // Time indicators like "2h", "4h", "23m"
            name.length < 3) {
          continue;
        }
        
        // Extract friend ID from href
        const linkSelectors = [
          'a[href*="/friends/"]',
          'a[href*="/profile.php"]',
          'a[role="link"]'
        ];
        
        let linkElement = null;
        for (const selector of linkSelectors) {
          linkElement = element.matches(selector) ? element : element.querySelector(selector);
          if (linkElement) break;
        }
        
        if (!linkElement) {
          // If no link element found, try to find the closest link
          linkElement = element.closest('a[role="link"]');
          if (!linkElement) continue;
        }
        
        const href = linkElement.getAttribute('href') || '';
        
        // Skip elements with non-profile hrefs
        if (href.includes('/groups/') || 
            href.includes('/events/') || 
            href.includes('/reels/') || 
            href.includes('/stories/') ||
            href.includes('/pages/') ||
            href.includes('/marketplace/') ||
            href.includes('/gaming/') ||
            href.includes('/watch/') ||
            href === '/' ||
            href.includes('/bookmarks/') ||
            href.includes('/messages/') ||
            href.includes('/notifications/')) {
          continue;
        }
        
        const idMatch = href.match(/\/profile\.php\?id=(\d+)/) || 
                       href.match(/facebook\.com\/([^/?]+)/) ||
                       href.match(/\/([^/?]+)$/);
        
        const id = idMatch ? idMatch[1] : generateTempId(name);
        
        // Skip if this is likely not a person (common Facebook navigation items)
        if (id === 'friends' || 
            id === 'messages' || 
            id === 'notifications' || 
            id === 'marketplace' || 
            id === 'watch' || 
            id === 'gaming' || 
            id === 'groups' ||
            id === 'bookmarks') {
          continue;
        }
        
        // Check if we already have this friend (by ID)
        if (friends.some(f => f.id === id)) {
          continue;
        }
        
        // Log successful friend identification
        console.log(`Found friend: ${name} (${id})`);
        
        friends.push({ id, name, element });
      } catch (err) {
        console.error('Error processing friend element:', err);
      }
    }
  } catch (error) {
    console.error('Error scanning visible friends:', error);
  }
  
  console.log(`Scanned and found ${friends.length} visible friends`);
  return friends;
}

// Function to process friends for unfriending
async function processFriendsForUnfriending(friendsToProcess, delay) {
  // Validate delay (convert to milliseconds, ensure it's within 1-30 seconds)
  const validatedDelay = Math.min(Math.max(parseInt(delay) || 2, 1), 30) * 1000;
  console.log(`Processing with delay: ${validatedDelay/1000} seconds`);
  
  let processedCount = 0;
  let whitelist = [];
  
  // Get whitelist from storage
  try {
    const data = await new Promise(resolve => chrome.storage.sync.get(['whitelist'], resolve));
    whitelist = data.whitelist || [];
    console.log(`Whitelist loaded with ${whitelist.length} friends`);
  } catch (error) {
    console.error('Error loading whitelist:', error);
    whitelist = [];
  }
  
  // ... existing code ...
}

// Function to process friends for unfollowing
async function processFriendsForUnfollowing(friendsToProcess, delay) {
  // Validate delay (convert to milliseconds, ensure it's within 1-30 seconds)
  const validatedDelay = Math.min(Math.max(parseInt(delay) || 2, 1), 30) * 1000;
  console.log(`Processing with delay: ${validatedDelay/1000} seconds`);
  
  let processedCount = 0;
  let whitelist = [];
  
  // Get whitelist from storage
  try {
    const data = await new Promise(resolve => chrome.storage.sync.get(['whitelist'], resolve));
    whitelist = data.whitelist || [];
    console.log(`Whitelist loaded with ${whitelist.length} friends`);
  } catch (error) {
    console.error('Error loading whitelist:', error);
    whitelist = [];
  }
  
  // ... existing code ...
}

// Function to wait with proper delay validation
function wait(ms) {
  // Ensure ms is a reasonable value (between 1-30 seconds)
  // Default to 2 seconds (2000ms) if not specified
  const validMs = Math.min(Math.max(parseInt(ms) || 2000, 1000), 30000);
  console.log(`Waiting for ${validMs/1000} seconds`);
  return new Promise(resolve => setTimeout(resolve, validMs));
} 