/**
 * The source-of-truth catalogue. Every other locale is typed against this, so
 * adding a key here is a compile error until every language provides it.
 *
 * Values may contain `{placeholders}`, and `|` separates singular|plural for
 * keys used with a count.
 */
export const en = {
  'app.name': 'Liha',
  'app.tagline':
    'Share a build, a design or a document at a stable URL. Reviewers mark up what they see; an AI agent reads that feedback with structured context and ships the fix to the same link.',

  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.clear': 'Clear',
  'common.loading': 'Loading',
  'common.somethingWrong': 'Something went wrong.',

  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.ja': '日本語',

  'theme.label': 'Colour theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'theme.switchTo': 'Theme: {current} — switch to {next}',

  'topbar.version': 'Version',
  'topbar.versionCurrent': 'current',
  'topbar.share': 'Share',
  'topbar.update': 'Update',
  'topbar.ownerSettings': 'Owner settings',
  'topbar.shortcuts': 'Keyboard shortcuts',
  'topbar.passwordProtected': 'Password protected',
  'topbar.agentConnected': 'An agent can act on this page through WebMCP',

  'tool.inspect': 'Inspect',
  'tool.inspect.hint': 'Click an element to comment on it',
  'tool.pin': 'Pin',
  'tool.pin.hint': 'Drop a numbered pin',
  'tool.rect': 'Box',
  'tool.rect.hint': 'Draw a box around an area',
  'tool.freehand': 'Draw',
  'tool.freehand.hint': 'Freehand red pen',
  'tool.arrow': 'Arrow',
  'tool.arrow.hint': 'Point at something',
  'viewport.fit': 'Fit to window',
  'viewport.width': '{width}px viewport',

  'filter.open': 'Open',
  'filter.resolved': 'Resolved',
  'filter.all': 'All',
  'filter.label': 'Filter comments',

  'comments.title': 'Review comments',
  'comments.emptyOpen': 'No open comments.',
  'comments.emptyResolved': 'Nothing resolved yet.',
  'comments.emptyAll': 'No comments yet.',
  'comments.emptyHint': 'Click anywhere on the preview to leave one, or press {key}.',
  'comments.reply': 'Reply',
  'comments.replyTo': 'Reply to {name}…',
  'comments.resolve': 'Resolve',
  'comments.reopen': 'Reopen',
  'comments.outdated': 'outdated',
  'comments.showEarlier': 'Show {count} earlier reply|Show {count} earlier replies',
  'comments.byAuthor': 'Comment {index} by {author}: {body}',
  'comments.added': 'Comment added.',
  'comments.replyAdded': 'Reply added.',
  'comments.resolved': 'Comment resolved.',

  'composer.placeholder': 'What needs to change?',
  'composer.placeholderVersion': 'Comment on this version…',
  'composer.submit': 'Comment',
  'composer.submitReply': 'Reply',
  'composer.yourName': 'Your name',
  'composer.changeName': 'Change the name shown on your comments',
  'composer.removeTarget': 'Remove target',
  'composer.clearTargetHint': 'Clear target (Esc)',
  'composer.submitHint': 'Submit (⌘↵)',
  'composer.writing': 'Writing a comment on the preview…',
  'composer.dialogLabel': 'Write a comment',

  'version.viewingOld': 'Viewing v{number}. The share URL serves a different version.',
  'version.backToCurrent': 'Back to current',

  'share.title': 'Share',
  'share.url': 'Share URL — stable across versions',
  'share.previewId': 'Preview ID',
  'share.ownerToken': 'Owner token — keep secret',
  'share.summary': 'Summary for chat',

  'upload.title': 'New version',
  'upload.explain':
    'The share URL does not change. Existing comments stay attached to the version they were left on.',
  'upload.drop': 'Drop files or a folder',
  'upload.files': 'Files',
  'upload.folder': 'Folder',
  'upload.label': 'Label (optional)',
  'upload.publish': 'Publish',
  'upload.fileCount': '{count} file|{count} files',

  'owner.title': 'Owner settings',
  'owner.currentVersion': 'Version served at the share URL',
  'owner.password': 'Password',
  'owner.passwordSet': 'currently set',
  'owner.passwordOff': 'currently off',
  'owner.newPassword': 'New password (6+ characters)',
  'owner.set': 'Set',
  'owner.remove': 'Remove',
  'owner.delete': 'Delete preview',
  'owner.deleteConfirm': 'Delete permanently',

  'password.protected': 'This preview is password protected.',
  'password.placeholder': 'Password',
  'password.unlock': 'Unlock',

  'offline.title': 'Cannot reach the server',
  'offline.body':
    'The preview could not be loaded because the Liha API did not respond. Your connection may be down, or the server may be restarting.',
  'offline.retry': 'Try again',
  'notFound.title': 'Preview not found',
  'notFound.body': 'The link may have expired, or the preview may have been deleted.',
  'notFound.create': 'Create a new preview',

  'error.title': 'Something went wrong',
  'error.body':
    'The page failed to render. Reloading usually fixes it — your comments are saved on the server, and any unsent draft is kept in this browser.',
  'error.reload': 'Reload',
  'error.startOver': 'Start over',

  'agent.title': 'Agent tools on this page',
  'agent.available':
    'Your browser supports WebMCP. This page is publishing {count} tools to your agent.',
  'agent.unavailable':
    'This browser does not expose WebMCP, so no tools are published. The review still works normally.',
  'agent.howto':
    'To try it: open this URL in ChatGPT’s in-app browser, or in Chrome with the WebMCP origin trial or chrome://flags/#enable-webmcp-testing.',
  'agent.tryAsking': 'Try asking your agent',
  'agent.prompt1': 'What review feedback is open on this preview, and what does it point at?',
  'agent.prompt2': 'Show me the comment about the button, then read the CSS behind it.',
  'agent.prompt3': 'Switch the preview to mobile width and tell me what breaks.',
  'agent.toolsHeading': 'Published tools',
  'agent.detected': 'Detected on {source} using {style}.',
  'agent.readOnly': 'read',
  'agent.writes': 'acts',
  'agent.open': 'Agent tools',

  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.tools': 'Tools',
  'shortcuts.comments': 'Comments',
  'shortcuts.view': 'View',
  'shortcuts.startComment': 'Start a comment',
  'shortcuts.submit': 'Submit',
  'shortcuts.nextPrev': 'Next / previous comment',
  'shortcuts.resolve': 'Resolve the selected comment (owner)',
  'shortcuts.escape': 'Cancel the draft or deselect',
  'shortcuts.viewports': 'Viewport: fit, 1280, 768, 390',
  'shortcuts.theme': 'Cycle the colour theme',
  'shortcuts.thisList': 'This list',

  'home.howTo': 'How it works',
  'home.modeDrop': 'Drop and share',
  'home.modeUrl': 'Review a URL',
  'home.modeCli': 'From the terminal',
  'home.sample': 'See a sample',
  'home.createHeading': 'Create this preview?',

  'decor.scrawl': 'text too small here',
  'decor.specOk': 'p.3 OK',
  'decor.sticky': 'Reviewers draw\nstraight on\nthe screen',
  'decor.comments': 'An agent reads it and\nships the fix to the same URL',
  'decor.password': 'you can password-protect it',
  'decor.dropLabel': 'drag & drop',
  'decor.urlLabel': 'a URL that never changes',

  'onboard.title': 'How Liha works',
  'onboard.step': '{current} / {total}',
  'onboard.close': 'close',
  'onboard.skip': 'Skip',
  'onboard.next': 'Next',
  'onboard.openSample': 'Open a sample',
  'onboard.goTo': 'Step {step}',
  'onboard.1.title': 'First, hand over a stable URL',
  'onboard.1.body': 'A static site, a PDF, an image — just drop it.',
  'onboard.2.title': 'Mark it up where you see it',
  'onboard.2.body': 'Reviewers write straight onto the screen.',
  'onboard.3.title': 'The fix lands at the same URL',
  'onboard.3.body': 'An agent reads the feedback and ships it.',
  'onboard.fix': 'fix this',
  'onboard.sameUrl': 'same URL · v2',

  'home.dropTitle': 'Drop a file, a folder, or a zipped site',
  'home.dropHint': 'HTML & static sites · PNG, JPEG, WebP · PDF',
  'home.ready': '{count} file ready|{count} files ready',
  'home.title': 'Title (optional)',
  'home.titlePlaceholder': 'Checkout redesign',
  'home.password': 'Password (optional)',
  'home.passwordPlaceholder': 'At least 6 characters',
  'home.create': 'Create preview',
  'home.urlHeading': 'Or review a URL that is already deployed',
  'home.urlPlaceholder': 'https://example.com/landing',
  'home.import': 'Import',
  'home.urlHint':
    'Liha snapshots the page HTML so reviewers can mark it up. Private and internal addresses are rejected.',

  'created.title': 'Preview created',
  'created.body':
    'Share the URL below. It stays the same for every future version, so reviewers never need a new link.',
  'created.ownerLink': 'Owner link (includes the token)',
  'created.ownerNote':
    'The owner token is stored in this browser. It is required to publish new versions, resolve comments, change the password and delete the preview. It is shown once and cannot be recovered.',
  'created.open': 'Open preview',
  'created.another': 'Create another',
  'created.agentHeading': 'Connect your coding agent',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
