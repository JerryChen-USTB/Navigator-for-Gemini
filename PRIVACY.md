# Privacy Policy

**Navigator for Gemini**

Last Updated: February 9, 2026

---

## Overview

Navigator for Gemini is a Chrome browser extension that provides a sidebar table-of-contents navigation for Google Gemini conversation pages, enabling quick navigation and AI-powered conversation summarization. We take user privacy seriously. This Privacy Policy explains how this extension handles user data.

## Data Collection

**This extension does not collect, store, or share any personal user information.**

We do not operate any database and do not record users' identity information, browsing history, IP addresses, or any other personal data.

## Data Usage

### Local Data Storage

This extension stores the following data locally in the user's browser only:

- **Custom directory item names**: Titles manually renamed by the user or generated via AI summarization are stored in the browser's `chrome.storage.local` and remain solely on the user's local device.
- **Panel collapse state**: The panel's expanded/collapsed preference is stored in the browser's `localStorage`.

All of the above data remains entirely within the user's local browser and is never transmitted to any external server.

### Remote Server Communication

This extension communicates with a remote server (`jerrystudio.top`) **solely for the AI summarization feature**. Details are as follows:

- **Purpose**: When the user actively clicks the "AI Summary" button, the extension sends the text content of the current conversation turn to the server, which calls an AI model to generate a brief summary and returns the result to the user.
- **Trigger**: This feature is triggered only by explicit user action (clicking the button). No data is sent automatically.
- **Data processing**: The server acts only as a relay proxy for the AI API call, processing requests in real time and returning results. **The server does not have any database and does not store, log, or retain any conversation content sent by users.**
- **Data scope**: The content sent is limited to a single conversation turn (one question-answer pair) selected by the user, and the text is truncated to a maximum of 1,000 characters.

## Data Sharing

This extension does not sell, trade, or otherwise transfer user data to any third party. Conversation text transmitted during the AI summarization process is used exclusively to generate summaries and for no other purpose.

## Permissions

This extension requests the following browser permissions:

| Permission | Purpose |
|------------|---------|
| `storage` | Store user-customized directory item names locally |
| `host_permissions: gemini.google.com` | Inject the navigation sidebar into Gemini pages |
| `host_permissions: jerrystudio.top` | Access the AI summarization service |

## User Control

- Users may choose not to use the AI summarization feature at any time; in this case, the extension will not communicate with any remote server.
- Users can clear all locally stored data for this extension through their browser settings.
- Users can uninstall this extension at any time, and all local data will be automatically removed.

## Changes to This Privacy Policy

If this Privacy Policy is updated, we will notify users through an extension update.

## Contact

If you have any questions about this Privacy Policy, please contact us via:

- GitHub Issues: [Navigator for Gemini](https://github.com)

---

*This extension is committed to complying with all user privacy requirements set forth in the Chrome Web Store Developer Program Policies.*
