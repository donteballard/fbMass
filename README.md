# Facebook Mass Unfriend/Unfollow Extension

A Chrome extension that helps you mass unfriend or unfollow people on Facebook with features like search, whitelist, and daily limits.

## Features

- **Mass Unfriend/Unfollow**: Automatically process your Facebook friends list
- **Search**: Filter friends by name
- **Whitelist**: Mark important friends to prevent accidental unfriending
- **Delay Control**: Set the time between actions to avoid triggering Facebook's automated systems
- **Daily Limits**: Set a maximum number of actions per day (default: 500)
- **Refresh**: Reload your friends list at any time

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the folder containing the extension files
5. The extension icon should appear in your Chrome toolbar

## How to Use

1. Navigate to Facebook: `https://www.facebook.com/`
2. Click the extension icon in your Chrome toolbar
3. The extension will attempt to find your friends list
4. **For best results**, navigate to your Facebook friends list page at `https://www.facebook.com/friends/list`
5. Use the search box to filter friends if needed
6. Check the boxes next to friends you want to keep (whitelist)
7. Set your preferred delay between actions (in seconds)
8. Set your daily limit (default: 500)
9. Click "Unfriend" to start unfriending or "Unfollow" to start unfollowing
10. You can click "Stop" at any time to pause the process
11. Use the refresh button (↻) to reload your friends list

## Important Notes

- **Use at your own risk**: Facebook may detect automated activity and take action against your account
- **Start with longer delays**: Begin with longer delays (5-10 seconds) and gradually reduce if needed
- **Respect limits**: Facebook has hidden limits on how many actions you can take per day
- **Be patient**: The extension works in the background while you keep the Facebook tab open
- **DOM Changes**: Facebook frequently updates their website structure, which may break the extension. If this happens, please check for updates.
- **Friends List Page**: The extension works best on the dedicated friends list page (`https://www.facebook.com/friends/list`) rather than the sidebar

## Troubleshooting

- **No friends showing**: Make sure you're on Facebook and try clicking the refresh button
- **Process stops**: Facebook may have temporarily blocked actions - wait a few hours before trying again
- **Extension not working**: Facebook may have updated their website structure - check for extension updates
- **Console logs**: Open Chrome DevTools (F12) and check the console for detailed error messages
- **Navigation**: If you're having trouble, try navigating directly to `https://www.facebook.com/friends/list`

## Privacy

This extension:
- Does NOT collect any of your personal data
- Does NOT send any data to external servers
- All processing happens locally in your browser
- Your whitelist is stored in your browser's local storage

## License

MIT License 