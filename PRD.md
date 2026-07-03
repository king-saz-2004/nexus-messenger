# Nexus Messenger Product Requirements Document

## 1. Overview

Nexus Messenger is a modern self-hosted messaging platform designed for private communication between individuals, groups, teams, communities, and small organizations.

The product provides a familiar chat experience similar to modern consumer messengers, while giving the host full ownership and control over deployment, users, data, media storage, and access rules.

Nexus is not intended to become a heavy enterprise collaboration suite. Its goal is to remain lightweight, easy to deploy, easy to use, and easier to operate than platforms such as Rocket.Chat or Zulip.

## 2. Product Vision

Nexus Messenger should feel like a private, self-hosted Telegram-style messenger.

The core vision is:س

* Give users a modern messaging experience.
* Allow anyone to host their own private chat server.
* Avoid dependency on public messaging platforms.
* Keep the interface simple and familiar.
* Provide enough moderation and administration tools for real-world group and team usage.
* Make deployment and maintenance significantly easier than traditional self-hosted collaboration platforms.

## 3. Target Users

Nexus Messenger is designed for:

* Small companies and internal teams
* Private communities
* Groups of friends
* Families
* Independent organizations
* Technical users who want to host their own messaging server
* Groups that do not want to rely on public messengers
* Communities that need private, controlled communication

The product should be usable by both technical administrators and non-technical end users.

## 4. Product Positioning

Nexus Messenger sits between simple private chat apps and complex enterprise collaboration platforms.

It should be:

* Simpler than Rocket.Chat and Zulip
* More modern than older self-hosted chat tools
* Easier to install and maintain
* Familiar to users of Telegram-like messengers
* Suitable for both personal and group communication
* Practical for small organizations without requiring enterprise complexity

Nexus should not compete by having every possible enterprise feature. It should compete through simplicity, control, ownership, and a clean user experience.

## 5. Core Product Scope

The current product scope includes:

* Secure authentication
* User registration and login
* Private/direct chats
* Group chats
* Real-time messaging
* Text messages
* Image, video, audio, file, and voice messages
* Message replies
* Message editing
* Message deletion
* Message reactions
* Pinned messages
* Read receipts
* Typing indicators
* Online/presence indicators
* Message search inside accessible chats
* Contact management
* Blocking and unblocking contacts
* Group member management
* Group roles and permissions
* Root administration
* Registration control
* Pending user approval
* Media size limits
* Avatar upload and management
* RTL and multilingual UI support
* Docker-based self-hosted deployment

## 6. User Roles

### 6.1 Root Admin

The root admin manages the server-level configuration and platform-wide controls.

Responsibilities:

* Configure registration mode
* Approve or reject pending users
* Manage required registration fields
* Configure media upload limits
* Manage server-level settings
* Perform high-risk administrative actions
* Manage users when required

The root admin should have powerful controls, but destructive actions must require clear confirmation.

### 6.2 Regular User

A regular user can:

* Log in and manage their profile
* Create or join private chats
* Create or join group chats
* Send text and media messages
* Send voice messages
* Reply to messages
* React to messages
* Edit and delete their own messages when allowed
* Search messages in chats they can access
* Manage contacts
* Block or unblock users
* Manage active sessions

### 6.3 Group Owner

The group owner has full control over a group.

Capabilities:

* Edit group name and avatar
* Add or remove members
* Promote or demote admins
* Transfer ownership
* Manage group permissions
* Ban or unban members
* Delete the group
* Moderate messages according to group rules

### 6.4 Group Admin

A group admin can manage a group based on permissions granted by the group owner.

Possible permissions:

* Invite members
* Remove members
* Ban or unban users
* Edit group information
* Pin or unpin messages
* Delete messages
* Manage limited moderation actions

### 6.5 Group Member

A group member can:

* Read group messages
* Send messages if allowed
* Send media if allowed
* Reply to messages
* React to messages
* View group information
* Leave the group

## 7. Messaging Requirements

Messaging must be real-time, fast, and familiar.

Required messaging features:

* Send and receive messages in real time
* Support direct and group conversations
* Support text messages
* Support image, video, audio, file, and voice messages
* Show upload progress for media
* Support message replies
* Support message editing
* Support message deletion
* Support message reactions
* Support pinned messages
* Support read receipts
* Support typing indicators
* Support message search
* Handle reconnects gracefully
* Preserve message order
* Avoid duplicate messages after reconnect or retry

Message actions should not clutter the interface. Secondary actions should be placed inside context menus, long-press menus, or overflow menus.

## 8. Group Requirements

Groups must be powerful enough for real use, but simple enough for normal users.

Required group features:

* Create groups
* Edit group title
* Upload or remove group avatar
* Add members
* Remove members
* Leave group
* Transfer ownership
* Promote and demote admins
* Configure admin permissions
* Ban and unban members
* Restrict member actions when needed
* Delete group when allowed

Group management features should be placed in a dedicated group information panel or drawer, not in the main message flow.

## 9. Admin Requirements

The root admin panel should provide server-level controls.

Required admin features:

* View and manage registration settings
* Enable or disable public registration
* Review pending users
* Approve or reject users
* Configure required registration fields
* Configure media size limits
* Manage dangerous platform-wide cleanup actions
* Display clear warnings for destructive actions
* Require strong confirmation for irreversible operations

Dangerous actions must be intentionally difficult to trigger accidentally.

## 10. Privacy and Security Requirements

Nexus Messenger is designed for private self-hosted communication.

Security requirements:

* Secure session-based authentication
* Access token and refresh token handling
* Secure cookie configuration in production
* CSRF protection
* Origin validation
* Rate limiting for sensitive endpoints
* Password hashing
* Session invalidation
* Server-side permission checks
* Database-level access protection where applicable
* Safe media upload validation
* Media size restrictions
* Protection against unsafe file types
* Link preview disabled by default unless explicitly enabled
* SSRF protections for server-side URL fetching
* Clear separation between user-level and admin-level permissions

Access rules must ensure that users can only access chats, messages, media, and metadata they are authorized to access.

The privacy model must be documented clearly, especially regarding what the root admin can and cannot do.

## 11. Media Requirements

The system must support practical media messaging.

Supported media types:

* Images
* Videos
* Audio files
* Voice messages
* General files
* Avatars
* Group avatars

Media requirements:

* Validate file type server-side
* Enforce configurable size limits
* Store media in a self-hosted storage path
* Prevent unsafe formats where necessary
* Support media deletion
* Support media download where allowed
* Keep media access controlled by chat membership where applicable

## 12. UX Requirements

The user interface should feel modern, clean, and familiar.

UX principles:

* Keep the main chat screen focused on conversation
* Avoid showing advanced actions unless needed
* Use drawers, modals, and context menus for secondary actions
* Support both desktop and mobile layouts
* Support RTL languages
* Support light and dark themes
* Keep group and admin controls separate from normal messaging
* Make common actions fast and obvious
* Make dangerous actions slow and explicit

The product should feel like a modern messenger, not a complex enterprise dashboard.

## 13. Self-Hosting Requirements

Nexus Messenger must be deployable by users on their own infrastructure.

Current deployment target:

* Docker
* Docker Compose
* PostgreSQL
* Redis
* Local media storage
* Reverse proxy support
* Environment-based configuration

Deployment should support:

* Local development
* VPS deployment
* Small private server deployment
* Internal team deployment

The next major phase should focus on improving installation, updates, backup, restore, and operational tooling.

## 14. Installer and Operations Roadmap

A future installer should make Nexus significantly easier to deploy and maintain.

Planned operational commands may include:

* `nexus install`
* `nexus update`
* `nexus status`
* `nexus logs`
* `nexus backup`
* `nexus restore`
* `nexus configure`
* `nexus restart`
* `nexus uninstall`

Installer goals:

* Generate required environment configuration
* Configure secrets safely
* Validate domain and origin settings
* Help configure reverse proxy and TLS
* Initialize the database
* Create the first root admin
* Check service health
* Provide clear error messages
* Support safe updates
* Support backup and restore

The installer is a core part of the product strategy, not a minor utility.

## 15. Non-Goals

Nexus Messenger is not currently intended to be:

* A public social network
* A large-scale Telegram replacement
* A full enterprise collaboration suite
* A Slack replacement with integrations and workflows
* A federated messaging network
* A multi-tenant SaaS platform
* A bot marketplace
* A video conferencing platform
* A complete email replacement
* A full end-to-end encrypted messenger in the current version

These may be reconsidered in future phases, but they are not part of the current product goal.

## 16. Success Metrics

Product success should be measured by:

* A user can deploy the app with Docker Compose successfully.
* A technical user can complete initial setup without editing source code.
* A non-technical end user can start chatting without training.
* Messages are delivered in real time under normal network conditions.
* WebSocket reconnect works reliably.
* Users cannot access chats they do not belong to.
* Media upload limits are enforced correctly.
* Admin actions are clear and safe.
* The UI works well on desktop and mobile.
* RTL layout works correctly.
* Backup and restore become reliable in the installer phase.

Target operational goals:

* Docker-based setup should be possible in under 15 minutes for a technical user.
* Installer-based setup should eventually be possible in under 5 minutes.
* Message delivery latency should feel instant in normal usage.
* The app should remain usable on small VPS deployments.

## 17. Product Roadmap

### Phase 1 — Core Messenger

Focus:

* Authentication
* Direct chats
* Group chats
* Real-time messaging
* Media messages
* Voice messages
* Reactions
* Replies
* Message editing and deletion
* Read receipts
* Typing indicators
* Message search
* Group roles and permissions
* Contact management
* Admin approval
* Root admin controls
* RTL and theme support
* Docker deployment

### Phase 2 — Installer and Operations

Focus:

* Official installer
* One-command setup
* Update flow
* Backup and restore
* Status and logs tooling
* Production configuration checks
* Safer migration handling
* Domain and TLS guidance
* First admin setup flow

### Phase 3 — Hardening

Focus:

* Expanded test coverage
* Security testing
* Permission testing
* Better audit visibility
* Storage usage dashboard
* Improved mobile UX
* Better error handling
* More stable reconnect behavior
* Admin observability

### Phase 4 — Extended Capabilities

Possible future work:

* Progressive Web App improvements
* Native mobile app
* Optional end-to-end encryption research
* Webhooks
* Bots
* Notification improvements
* Advanced moderation tools
* Optional integrations
* Optional voice/video calls

## 18. Product Principle

Nexus Messenger should remain simple in daily use, even if it becomes powerful internally.

The correct product direction is not to remove useful messaging features, but to present them cleanly, keep advanced controls out of the way, and make deployment easier than competing self-hosted platforms.
