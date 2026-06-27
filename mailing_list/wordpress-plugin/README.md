# Andrew's Writing Journal Newsletter

This is a self-hosted WordPress plugin for your mailing list page.

What it does:

- Adds a shortcode: `[andrew_writing_journal_signup]`
- Stores subscribers directly in your WordPress database
- Creates a `Writing Journal` admin menu in wp-admin
- Adds a small wp-admin page for editing landing page copy
- Lets you edit the landing page link buttons from wp-admin
- Lets you send basic broadcasts from wp-admin with `wp_mail`
- Saves broadcast and test-send entries in campaign history
- Lets you send test emails before mailing the full list
- Appends unique unsubscribe links to each outgoing broadcast
- Lets you export subscribers as CSV
- Keeps the page focused on your writing and journal, not just Extal

## Install

1. Copy the `wordpress-plugin` folder into your WordPress plugins directory.
2. Rename the folder if you want, but keep `andrew-writing-journal-newsletter.php` inside it.
3. In wp-admin, go to Plugins and activate `Andrew's Writing Journal Newsletter`.

If you want an uploadable plugin zip, use the packaged archive created from this folder rather than uploading the entire project.

## Use

Create or edit a page in WordPress and add this shortcode:

```text
[andrew_writing_journal_signup]
```

If you build pages with Elementor, use a `Shortcode` widget and paste the shortcode there.

To edit the built-in landing page text without touching PHP, go to:

- `Writing Journal` -> `Landing Page Copy`

That screen now includes:

- editable labels and URLs for the landing-page link buttons
- a live preview box showing how the current landing module will look

There is also a separate preview screen at:

- `Writing Journal` -> `Landing Page Preview`

And the settings page now controls:

- the subscribe button text
- the main email branding text used in outgoing broadcasts and test emails

Optional shortcode attributes:

```text
[andrew_writing_journal_signup title="Join Andrew's Writing Journal" subtitle="Get fiction updates, journal entries, and behind-the-scenes notes from ongoing projects."]
```

## Subscriber Management

After activation, go to the `Writing Journal` menu in wp-admin.

There you can:

- View subscribers stored in WordPress
- See names, email addresses, interests, and notes
- See who is still subscribed vs unsubscribed
- Send a basic broadcast to active subscribers
- Send a test email to yourself before broadcasting
- Review recent campaign history
- Export everything to CSV

## Broadcast Sending

The plugin now includes a simple broadcast sender inside wp-admin.

Notes:

- It sends with WordPress `wp_mail`
- It sends one message per subscriber so each email has its own unsubscribe link
- It is suitable for a small or moderate list, not a large-scale email platform
- You should have WordPress SMTP configured properly if you want reliable delivery
- Every send is logged in campaign history

Available placeholders in the broadcast body:

```text
{{first_name}}
{{last_name}}
{{email}}
{{unsubscribe_url}}
```

The unsubscribe footer is also added automatically.

## Test Sending

Before sending a full broadcast, use the `Send Test Email` section in wp-admin.

This will:

- send the message to one chosen address
- render placeholder values with sample data
- append the same footer structure used in broadcasts
- save the test in campaign history

## Campaign History

The admin screen now keeps a recent history of sends.

Each history row tracks:

- date sent
- whether it was a broadcast or test
- subject line
- sent count
- failed count
- recipient limit or test address

## Unsubscribes

Each subscriber gets a unique unsubscribe token stored in WordPress.

When a reader clicks the unsubscribe link in an email:

- their status changes to `unsubscribed`
- they stop receiving future broadcasts
- the unsubscribe is handled directly by your WordPress site

## Important Limitation

This plugin stores subscriptions locally and now sends basic broadcasts, but it is still **not** a full email marketing platform.

That means it handles:

- signup collection
- local storage
- admin review
- basic broadcast sending
- CSV export
- one-click unsubscribe links

It does not handle:

- advanced bulk email infrastructure
- scheduling broadcasts
- bounce handling
- analytics like opens/clicks
- segmentation and automation flows

If you want to keep everything inside WordPress, the next step after this is usually one of these:

1. Use this plugin only for collection, then send manual emails from your normal mail setup.
2. Pair it with your own SMTP-configured WordPress install for better delivery.
3. Extend it later with scheduling, templates, or campaign history if the list grows.

## Recommended Page Setup

Use a normal WordPress page and put only the shortcode in the content area. The plugin includes its own styling and should render cleanly inside most themes.

For Elementor:

- add a `Shortcode` widget to the page
- paste `[andrew_writing_journal_signup]`
- let Elementor handle the surrounding page layout while the plugin renders the signup module itself