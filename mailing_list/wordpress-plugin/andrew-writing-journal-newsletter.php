<?php
/**
 * Plugin Name: Andrew's Writing Journal Newsletter
 * Plugin URI: https://andrewnusz.com/
 * Description: Self-hosted newsletter signup for Andrew D Nusz's writing journal with local WordPress subscriber storage and CSV export.
 * Version: 1.6.4
 * Author: Andrew D Nusz
 * Author URI: https://andrewnusz.com/
 * License: GPL-2.0-or-later
 * Text Domain: andrew-writing-journal-newsletter
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Andrew_Writing_Journal_Newsletter {
    const VERSION = '1.6.4';
    const TABLE_SLUG = 'andrew_writing_journal_subscribers';
    const CAMPAIGN_TABLE_SLUG = 'andrew_writing_journal_campaigns';
    const SHORTCODE = 'andrew_writing_journal_signup';
    const SETTINGS_OPTION = 'awjn_page_copy';
    const STATUS_PARAM = 'awjn_status';
    const ADMIN_STATUS_PARAM = 'awjn_admin_status';
    const UNSUBSCRIBE_PARAM = 'awjn_unsubscribe';
    const NONCE_ACTION = 'awjn_signup';
    const EXPORT_NONCE_ACTION = 'awjn_export_csv';
    const SEND_NONCE_ACTION = 'awjn_send_broadcast';
    const TEST_NONCE_ACTION = 'awjn_send_test';

    public static function bootstrap() {
        $instance = new self();
        $instance->register_hooks();
    }

    public static function activate() {
        self::install_schema();
        self::ensure_unsubscribe_tokens();
        update_option('awjn_db_version', self::VERSION);
    }

    private static function install_schema() {
        global $wpdb;

        $table_name = self::table_name();
        $campaign_table_name = self::campaign_table_name();
        $charset_collate = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $sql = "CREATE TABLE {$table_name} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            email VARCHAR(190) NOT NULL,
            first_name VARCHAR(100) NOT NULL DEFAULT '',
            last_name VARCHAR(100) NOT NULL DEFAULT '',
            interest VARCHAR(100) NOT NULL DEFAULT '',
            note TEXT NULL,
            source VARCHAR(100) NOT NULL DEFAULT '',
            ip_address VARCHAR(100) NOT NULL DEFAULT '',
            user_agent TEXT NULL,
            unsubscribe_token VARCHAR(64) NULL DEFAULT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'subscribed',
            unsubscribed_at DATETIME NULL DEFAULT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY email (email),
            UNIQUE KEY unsubscribe_token (unsubscribe_token),
            KEY status (status),
            KEY created_at (created_at)
        ) {$charset_collate};";

        $campaign_sql = "CREATE TABLE {$campaign_table_name} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            subject VARCHAR(255) NOT NULL,
            body LONGTEXT NULL,
            sent_count INT(11) NOT NULL DEFAULT 0,
            failed_count INT(11) NOT NULL DEFAULT 0,
            recipient_limit INT(11) NOT NULL DEFAULT 0,
            test_email VARCHAR(190) NOT NULL DEFAULT '',
            mode VARCHAR(20) NOT NULL DEFAULT 'broadcast',
            created_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
            sent_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY mode (mode),
            KEY sent_at (sent_at)
        ) {$charset_collate};";

        dbDelta($sql);
        dbDelta($campaign_sql);
    }

    private static function ensure_unsubscribe_tokens() {
        global $wpdb;

        $table_name = self::table_name();
        $rows = $wpdb->get_results("SELECT id FROM {$table_name} WHERE unsubscribe_token IS NULL OR unsubscribe_token = ''");

        if (empty($rows)) {
            return;
        }

        foreach ($rows as $row) {
            $wpdb->update(
                $table_name,
                ['unsubscribe_token' => self::generate_token()],
                ['id' => (int) $row->id]
            );
        }
    }

    private function register_hooks() {
        add_shortcode(self::SHORTCODE, [$this, 'render_shortcode']);
        add_action('admin_post_nopriv_awjn_signup', [$this, 'handle_signup']);
        add_action('admin_post_awjn_signup', [$this, 'handle_signup']);
        add_action('admin_post_awjn_send_broadcast', [$this, 'handle_send_broadcast']);
        add_action('admin_post_awjn_send_test', [$this, 'handle_send_test']);
        add_action('admin_init', [$this, 'register_plugin_settings']);
        add_action('admin_menu', [$this, 'register_admin_page']);
        add_action('admin_post_awjn_export_csv', [$this, 'export_csv']);
        add_action('template_redirect', [$this, 'handle_unsubscribe_request']);
    }

    public function render_shortcode($atts = array()) {
        $this->ensure_schema_loaded();

        $copy = $this->get_page_copy_settings();

        $atts = shortcode_atts([
            'title' => $copy['title'],
            'subtitle' => $copy['subtitle'],
            'button_text' => $copy['button_text'],
        ], $atts, self::SHORTCODE);

        $status = isset($_GET[self::STATUS_PARAM]) ? sanitize_key(wp_unslash($_GET[self::STATUS_PARAM])) : '';
        $message = $this->status_message($status);
        $show_success_panel = in_array($status, array('success', 'updated'), true);

        ob_start();
        ?>
        <section class="awjn-shell">
            <style>
                .awjn-shell {
                    --awjn-bg: #140f0d;
                    --awjn-panel: rgba(26, 19, 15, 0.92);
                    --awjn-panel-soft: rgba(244, 234, 216, 0.96);
                    --awjn-paper: #f3e7d2;
                    --awjn-paper-soft: #d8c4a6;
                    --awjn-ink: #261b13;
                    --awjn-ink-soft: #5d4a39;
                    --awjn-gold: #cda468;
                    --awjn-gold-strong: #9b703d;
                    --awjn-line: rgba(230, 205, 170, 0.16);
                    --awjn-shadow: 0 24px 64px rgba(0, 0, 0, 0.34);
                    position: relative;
                    overflow: hidden;
                    margin: 24px auto;
                    border-radius: 28px;
                    border: 1px solid var(--awjn-line);
                    background:
                        radial-gradient(circle at top, rgba(138, 83, 30, 0.34), transparent 32%),
                        linear-gradient(180deg, #211610 0%, #140f0d 50%, #0f0b09 100%);
                    box-shadow: var(--awjn-shadow);
                    color: var(--awjn-paper);
                }

                .awjn-shell *,
                .awjn-shell *::before,
                .awjn-shell *::after {
                    box-sizing: border-box;
                }

                .awjn-wrap {
                    position: relative;
                    z-index: 1;
                    padding: 28px;
                }

                .awjn-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 430px);
                    gap: 24px;
                    align-items: stretch;
                }

                .awjn-copy {
                    padding: 6px 0;
                }

                .awjn-kicker,
                .awjn-mini,
                .awjn-form label,
                .awjn-button,
                .awjn-links a {
                    font-family: "Trebuchet MS", Verdana, sans-serif;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                }

                .awjn-kicker {
                    display: inline-block;
                    margin-bottom: 14px;
                    color: var(--awjn-paper-soft);
                    font-size: 0.72rem;
                }

                .awjn-copy h2,
                .awjn-panel h3,
                .awjn-quote {
                    font-family: Baskerville, "Times New Roman", serif;
                }

                .awjn-copy h2 {
                    margin: 0;
                    max-width: 12ch;
                    font-size: clamp(2.7rem, 6vw, 4.8rem);
                    line-height: 0.96;
                    letter-spacing: -0.04em;
                    color: #fff6e6;
                }

                .awjn-copy p,
                .awjn-panel p,
                .awjn-panel li,
                .awjn-form p,
                .awjn-notice {
                    color: #e7d5bb;
                    line-height: 1.74;
                    font-size: 1rem;
                }

                .awjn-points {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 12px;
                    margin-top: 28px;
                }

                .awjn-point {
                    padding: 14px;
                    border: 1px solid rgba(255, 227, 191, 0.12);
                    border-radius: 16px;
                    background: rgba(255, 248, 235, 0.05);
                }

                .awjn-mini {
                    margin-bottom: 8px;
                    color: var(--awjn-paper-soft);
                    font-size: 0.67rem;
                }

                .awjn-point p {
                    margin: 0;
                    font-size: 0.95rem;
                }

                .awjn-quote {
                    margin-top: 20px;
                    padding: 18px 20px;
                    border-left: 3px solid var(--awjn-gold);
                    border-radius: 0 14px 14px 0;
                    background: rgba(255, 248, 235, 0.06);
                    font-size: 1.1rem;
                    color: #f3e6d0;
                }

                .awjn-panel {
                    padding: 24px;
                    border-radius: 24px;
                    background: linear-gradient(180deg, rgba(244, 234, 216, 0.98), rgba(231, 214, 188, 0.96));
                    color: var(--awjn-ink);
                    box-shadow: 0 20px 44px rgba(0, 0, 0, 0.25);
                }

                .awjn-panel h3 {
                    margin: 0;
                    font-size: clamp(1.7rem, 2.6vw, 2.4rem);
                    color: var(--awjn-ink);
                    line-height: 1.08;
                }

                .awjn-panel p,
                .awjn-panel li {
                    color: var(--awjn-ink-soft);
                }

                .awjn-notice {
                    margin: 0 0 14px;
                    padding: 12px 14px;
                    border-radius: 14px;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                }

                .awjn-notice.success {
                    background: rgba(76, 175, 80, 0.12);
                    color: #22451f;
                }

                .awjn-notice.error {
                    background: rgba(176, 54, 54, 0.12);
                    color: #692121;
                }

                .awjn-success-panel {
                    margin-top: 18px;
                    padding: 22px;
                    border-radius: 18px;
                    background: linear-gradient(180deg, rgba(83, 136, 79, 0.14), rgba(205, 164, 104, 0.14));
                    border: 1px solid rgba(76, 175, 80, 0.22);
                    color: #2d4423;
                }

                .awjn-success-panel h4 {
                    margin: 0 0 10px 0;
                    font-family: Baskerville, "Times New Roman", serif;
                    font-size: 1.7rem;
                    line-height: 1.1;
                    color: #1f3218;
                }

                .awjn-success-panel p {
                    margin: 0;
                    color: #35502a;
                    font-size: 1rem;
                    line-height: 1.72;
                }

                .awjn-form {
                    margin-top: 18px;
                }

                .awjn-row {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 12px;
                }

                .awjn-field {
                    margin-top: 12px;
                }

                .awjn-form label {
                    display: block;
                    margin-bottom: 7px;
                    color: #6d5945;
                    font-size: 0.68rem;
                }

                .awjn-form input,
                .awjn-form select,
                .awjn-form textarea {
                    width: 100%;
                    padding: 14px 15px;
                    border: 1px solid rgba(114, 90, 62, 0.28);
                    border-radius: 14px;
                    background: rgba(255, 252, 246, 0.92);
                    color: var(--awjn-ink);
                    font: inherit;
                }

                .awjn-form textarea {
                    min-height: 110px;
                    resize: vertical;
                }

                .awjn-form input:focus,
                .awjn-form select:focus,
                .awjn-form textarea:focus {
                    outline: none;
                    border-color: rgba(155, 112, 61, 0.75);
                    box-shadow: 0 0 0 4px rgba(205, 164, 104, 0.18);
                }

                .awjn-button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    margin-top: 18px;
                    padding: 15px 18px;
                    border: 0;
                    border-radius: 999px;
                    background: linear-gradient(180deg, var(--awjn-gold), #b27d3d);
                    color: #140f0d;
                    cursor: pointer;
                    font-size: 0.75rem;
                    font-weight: 700;
                }

                .awjn-button:hover,
                .awjn-button:focus-visible {
                    filter: brightness(1.03);
                    transform: translateY(-1px);
                }

                .awjn-fine {
                    margin-top: 12px;
                    font-size: 0.86rem;
                    color: #6f5a45;
                }

                .awjn-links {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    margin-top: 18px;
                }

                .awjn-links a {
                    display: inline-flex;
                    align-items: center;
                    padding: 9px 12px;
                    border-radius: 999px;
                    background: rgba(255, 248, 235, 0.06);
                    border: 1px solid rgba(255, 227, 191, 0.16);
                    text-decoration: none;
                    color: #f0dec0;
                    font-size: 0.7rem;
                }

                .awjn-hidden {
                    position: absolute !important;
                    width: 1px;
                    height: 1px;
                    padding: 0;
                    margin: -1px;
                    overflow: hidden;
                    clip: rect(0, 0, 0, 0);
                    white-space: nowrap;
                    border: 0;
                }

                @media (max-width: 900px) {
                    .awjn-grid,
                    .awjn-points,
                    .awjn-row {
                        grid-template-columns: 1fr;
                    }

                    .awjn-wrap,
                    .awjn-panel {
                        padding: 20px;
                    }

                    .awjn-copy h2 {
                        max-width: none;
                    }
                }
            </style>

            <div class="awjn-wrap">
                <div class="awjn-grid">
                    <div class="awjn-copy">
                        <div class="awjn-kicker">Andrew D Nusz | Writing Journal</div>
                        <h2><?php echo esc_html($atts['title']); ?></h2>
                        <p><?php echo esc_html($atts['subtitle']); ?></p>

                        <div class="awjn-points">
                            <article class="awjn-point">
                                <div class="awjn-mini"><?php echo esc_html($copy['point_1_label']); ?></div>
                                <p><?php echo esc_html($copy['point_1_text']); ?></p>
                            </article>
                            <article class="awjn-point">
                                <div class="awjn-mini"><?php echo esc_html($copy['point_2_label']); ?></div>
                                <p><?php echo esc_html($copy['point_2_text']); ?></p>
                            </article>
                            <article class="awjn-point">
                                <div class="awjn-mini"><?php echo esc_html($copy['point_3_label']); ?></div>
                                <p><?php echo esc_html($copy['point_3_text']); ?></p>
                            </article>
                        </div>

                        <div class="awjn-quote"><?php echo esc_html($copy['quote']); ?></div>

                        <?php $links = $this->get_page_links($copy); ?>
                        <?php if (!empty($links)) : ?>
                            <div class="awjn-links">
                                <?php foreach ($links as $link) : ?>
                                    <a href="<?php echo esc_url($link['url']); ?>"><?php echo esc_html($link['label']); ?></a>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>
                    </div>

                    <aside class="awjn-panel">
                        <h3><?php echo esc_html($copy['panel_title']); ?></h3>
                        <p><?php echo esc_html($copy['panel_intro']); ?></p>

                        <?php if ($message !== null && !$show_success_panel) : ?>
                            <div class="awjn-notice <?php echo esc_attr($message['type']); ?>">
                                <?php echo esc_html($message['text']); ?>
                            </div>
                        <?php endif; ?>

                        <?php if ($show_success_panel) : ?>
                            <div class="awjn-success-panel">
                                <h4><?php esc_html_e('You are signed up.', 'andrew-writing-journal-newsletter'); ?></h4>
                                <p><?php echo esc_html($message['text']); ?></p>
                            </div>
                        <?php else : ?>
                            <form class="awjn-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                                <input type="hidden" name="action" value="awjn_signup">
                                <input type="hidden" name="source" value="wordpress-shortcode">
                                <?php wp_nonce_field(self::NONCE_ACTION, 'awjn_nonce'); ?>

                                <div class="awjn-row">
                                    <div class="awjn-field">
                                        <label for="awjn_first_name">First Name</label>
                                        <input id="awjn_first_name" name="first_name" type="text" autocomplete="given-name">
                                    </div>
                                    <div class="awjn-field">
                                        <label for="awjn_last_name">Last Name</label>
                                        <input id="awjn_last_name" name="last_name" type="text" autocomplete="family-name">
                                    </div>
                                </div>

                                <div class="awjn-field">
                                    <label for="awjn_email">Email Address</label>
                                    <input id="awjn_email" name="email" type="email" autocomplete="email" required>
                                </div>

                                <div class="awjn-field">
                                    <label for="awjn_interest">What are you most here for?</label>
                                    <select id="awjn_interest" name="interest">
                                        <option value="Writing Journal">Writing journal updates</option>
                                        <option value="Fantasy Fiction">Fantasy fiction progress</option>
                                        <option value="Worldbuilding">Worldbuilding notes and process</option>
                                        <option value="Extal">Extal-related updates too</option>
                                    </select>
                                </div>

                                <div class="awjn-field">
                                    <label for="awjn_note">Optional Note</label>
                                    <textarea id="awjn_note" name="note" placeholder="What kind of updates are you most interested in?"></textarea>
                                </div>

                                <input class="awjn-hidden" type="text" name="company" tabindex="-1" autocomplete="off">

                                <button class="awjn-button" type="submit"><?php echo esc_html($atts['button_text']); ?></button>
                            </form>
                        <?php endif; ?>

                    </aside>
                </div>
            </div>
        </section>
        <?php

        return (string) ob_get_clean();
    }

    public function handle_signup() {
        $this->ensure_schema_loaded();

        if (!isset($_POST['awjn_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['awjn_nonce'])), self::NONCE_ACTION)) {
            $this->redirect_with_status('invalid_nonce');
        }

        $honeypot = isset($_POST['company']) ? trim((string) wp_unslash($_POST['company'])) : '';
        if ($honeypot !== '') {
            $this->redirect_with_status('spam_blocked');
        }

        $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        if ($email === '' || !is_email($email)) {
            $this->redirect_with_status('invalid_submission');
        }

        $first_name = isset($_POST['first_name']) ? sanitize_text_field(wp_unslash($_POST['first_name'])) : '';
        $last_name = isset($_POST['last_name']) ? sanitize_text_field(wp_unslash($_POST['last_name'])) : '';
        $interest = isset($_POST['interest']) ? sanitize_text_field(wp_unslash($_POST['interest'])) : '';
        $note = isset($_POST['note']) ? sanitize_textarea_field(wp_unslash($_POST['note'])) : '';
        $source = isset($_POST['source']) ? sanitize_text_field(wp_unslash($_POST['source'])) : 'wordpress-shortcode';

        global $wpdb;

        $table_name = self::table_name();
        $existing = $wpdb->get_row(
            $wpdb->prepare("SELECT id, unsubscribe_token FROM {$table_name} WHERE email = %s LIMIT 1", $email)
        );

        $now = current_time('mysql');
        $record = [
            'email' => $email,
            'first_name' => $first_name,
            'last_name' => $last_name,
            'interest' => $interest,
            'note' => $note,
            'source' => $source,
            'ip_address' => $this->request_ip(),
            'user_agent' => isset($_SERVER['HTTP_USER_AGENT']) ? substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])), 0, 1000) : '',
            'unsubscribe_token' => ($existing && !empty($existing->unsubscribe_token)) ? $existing->unsubscribe_token : self::generate_token(),
            'status' => 'subscribed',
            'unsubscribed_at' => null,
            'updated_at' => $now,
        ];

        if ($existing) {
            $updated = $wpdb->update(
                $table_name,
                $record,
                ['id' => (int) $existing->id]
            );

            if ($updated === false) {
                $this->redirect_with_status('save_failed');
            }

            $this->redirect_with_status('updated');
        }

        $record['created_at'] = $now;
        $inserted = $wpdb->insert(
            $table_name,
            $record
        );

        if ($inserted === false) {
            $this->redirect_with_status('save_failed');
        }

        $this->redirect_with_status('success');
    }

    public function register_admin_page() {
        add_menu_page(
            __('Writing Journal', 'andrew-writing-journal-newsletter'),
            __('Writing Journal', 'andrew-writing-journal-newsletter'),
            'manage_options',
            'awjn-subscribers',
            [$this, 'render_admin_page'],
            'dashicons-email-alt2',
            58
        );

        add_submenu_page(
            'awjn-subscribers',
            __('Landing Page Copy', 'andrew-writing-journal-newsletter'),
            __('Landing Page Copy', 'andrew-writing-journal-newsletter'),
            'manage_options',
            'awjn-landing-copy',
            [$this, 'render_settings_page']
        );

        add_submenu_page(
            'awjn-subscribers',
            __('Landing Page Preview', 'andrew-writing-journal-newsletter'),
            __('Landing Page Preview', 'andrew-writing-journal-newsletter'),
            'manage_options',
            'awjn-landing-preview',
            [$this, 'render_preview_page']
        );
    }

    public function register_plugin_settings() {
        register_setting(
            'awjn_page_copy_group',
            self::SETTINGS_OPTION,
            [$this, 'sanitize_page_copy_settings']
        );
    }

    public function sanitize_page_copy_settings($input) {
        $defaults = $this->get_page_copy_defaults();
        $sanitized = array();

        if (!is_array($input)) {
            return $defaults;
        }

        foreach ($defaults as $key => $value) {
            $raw = isset($input[$key]) ? wp_unslash($input[$key]) : $value;
            if (strpos($key, '_url') !== false) {
                $sanitized[$key] = esc_url_raw($raw);
            } else {
                $sanitized[$key] = sanitize_text_field($raw);
            }
        }

        return $sanitized;
    }

    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'andrew-writing-journal-newsletter'));
        }

        $copy = $this->get_page_copy_settings();
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Landing Page Copy', 'andrew-writing-journal-newsletter'); ?></h1>
            <p><?php esc_html_e('Edit the main text used by the newsletter signup shortcode. Elementor can still handle the page layout around it.', 'andrew-writing-journal-newsletter'); ?></p>

            <form method="post" action="options.php">
                <?php settings_fields('awjn_page_copy_group'); ?>
                <table class="form-table" role="presentation">
                    <tbody>
                        <tr>
                            <th scope="row"><label for="awjn_title"><?php esc_html_e('Main Title', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_title" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[title]" type="text" value="<?php echo esc_attr($copy['title']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_subtitle"><?php esc_html_e('Subtitle', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_subtitle" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[subtitle]" rows="3"><?php echo esc_textarea($copy['subtitle']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_1_label"><?php esc_html_e('Card 1 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_point_1_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_1_label]" type="text" value="<?php echo esc_attr($copy['point_1_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_1_text"><?php esc_html_e('Card 1 Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_point_1_text" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_1_text]" rows="2"><?php echo esc_textarea($copy['point_1_text']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_2_label"><?php esc_html_e('Card 2 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_point_2_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_2_label]" type="text" value="<?php echo esc_attr($copy['point_2_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_2_text"><?php esc_html_e('Card 2 Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_point_2_text" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_2_text]" rows="2"><?php echo esc_textarea($copy['point_2_text']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_3_label"><?php esc_html_e('Card 3 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_point_3_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_3_label]" type="text" value="<?php echo esc_attr($copy['point_3_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_point_3_text"><?php esc_html_e('Card 3 Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_point_3_text" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[point_3_text]" rows="2"><?php echo esc_textarea($copy['point_3_text']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_quote"><?php esc_html_e('Quote / Highlight', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_quote" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[quote]" rows="3"><?php echo esc_textarea($copy['quote']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_panel_title"><?php esc_html_e('Form Panel Title', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_panel_title" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[panel_title]" type="text" value="<?php echo esc_attr($copy['panel_title']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_panel_intro"><?php esc_html_e('Form Panel Intro', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_panel_intro" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[panel_intro]" rows="3"><?php echo esc_textarea($copy['panel_intro']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_button_text"><?php esc_html_e('Subscribe Button Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_button_text" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[button_text]" type="text" value="<?php echo esc_attr($copy['button_text']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_1_label"><?php esc_html_e('Link 1 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_link_1_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_1_label]" type="text" value="<?php echo esc_attr($copy['link_1_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_1_url"><?php esc_html_e('Link 1 URL', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="large-text" id="awjn_link_1_url" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_1_url]" type="url" value="<?php echo esc_attr($copy['link_1_url']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_2_label"><?php esc_html_e('Link 2 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_link_2_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_2_label]" type="text" value="<?php echo esc_attr($copy['link_2_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_2_url"><?php esc_html_e('Link 2 URL', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="large-text" id="awjn_link_2_url" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_2_url]" type="url" value="<?php echo esc_attr($copy['link_2_url']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_3_label"><?php esc_html_e('Link 3 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_link_3_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_3_label]" type="text" value="<?php echo esc_attr($copy['link_3_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_3_url"><?php esc_html_e('Link 3 URL', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="large-text" id="awjn_link_3_url" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_3_url]" type="url" value="<?php echo esc_attr($copy['link_3_url']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_4_label"><?php esc_html_e('Link 4 Label', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_link_4_label" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_4_label]" type="text" value="<?php echo esc_attr($copy['link_4_label']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_link_4_url"><?php esc_html_e('Link 4 URL', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="large-text" id="awjn_link_4_url" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[link_4_url]" type="url" value="<?php echo esc_attr($copy['link_4_url']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_email_kicker"><?php esc_html_e('Email Brand Kicker', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_email_kicker" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[email_kicker]" type="text" value="<?php echo esc_attr($copy['email_kicker']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_email_title"><?php esc_html_e('Email Brand Title', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><input class="regular-text" id="awjn_email_title" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[email_title]" type="text" value="<?php echo esc_attr($copy['email_title']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_email_intro"><?php esc_html_e('Email Intro Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_email_intro" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[email_intro]" rows="3"><?php echo esc_textarea($copy['email_intro']); ?></textarea></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="awjn_email_footer"><?php esc_html_e('Email Footer Text', 'andrew-writing-journal-newsletter'); ?></label></th>
                            <td><textarea class="large-text" id="awjn_email_footer" name="<?php echo esc_attr(self::SETTINGS_OPTION); ?>[email_footer]" rows="3"><?php echo esc_textarea($copy['email_footer']); ?></textarea></td>
                        </tr>
                    </tbody>
                </table>
                <?php submit_button(__('Save Landing Page Copy', 'andrew-writing-journal-newsletter')); ?>
            </form>

            <div class="postbox" style="max-width: 980px; margin-top: 24px;">
                <div class="postbox-header">
                    <h2 class="hndle"><?php esc_html_e('Live Preview', 'andrew-writing-journal-newsletter'); ?></h2>
                </div>
                <div class="inside">
                    <?php $this->render_settings_preview($copy); ?>
                </div>
            </div>
        </div>
        <?php
    }

    public function render_preview_page() {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'andrew-writing-journal-newsletter'));
        }

        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Landing Page Preview', 'andrew-writing-journal-newsletter'); ?></h1>
            <p><?php esc_html_e('This renders the actual shortcode output using your saved settings, so it is closer to the front-end result than the compact settings preview.', 'andrew-writing-journal-newsletter'); ?></p>
            <div style="max-width: 1180px; margin-top: 20px;">
                <?php echo $this->render_shortcode(); ?>
            </div>
        </div>
        <?php
    }

    public function render_admin_page() {
        $this->ensure_schema_loaded();

        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'andrew-writing-journal-newsletter'));
        }

        global $wpdb;

        $table_name = self::table_name();
        $campaign_table_name = self::campaign_table_name();
        $admin_notice = $this->admin_status_message(isset($_GET[self::ADMIN_STATUS_PARAM]) ? sanitize_key(wp_unslash($_GET[self::ADMIN_STATUS_PARAM])) : '');
        $subscribers = $wpdb->get_results("SELECT * FROM {$table_name} ORDER BY created_at DESC LIMIT 500");
        $campaigns = $wpdb->get_results("SELECT * FROM {$campaign_table_name} ORDER BY sent_at DESC LIMIT 25");
        $count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table_name}");
        $active_count = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table_name} WHERE status = %s", 'subscribed'));
        ?>
        <div class="wrap">
            <h1><?php esc_html_e("Andrew's Writing Journal Subscribers", 'andrew-writing-journal-newsletter'); ?></h1>
            <p><?php echo esc_html(sprintf(__('Stored locally in WordPress. Total subscribers: %1$d. Active subscribers: %2$d', 'andrew-writing-journal-newsletter'), $count, $active_count)); ?></p>

            <?php if ($admin_notice !== null) : ?>
                <div class="notice notice-<?php echo esc_attr($admin_notice['type']); ?> is-dismissible">
                    <p><?php echo esc_html($admin_notice['text']); ?></p>
                </div>
            <?php endif; ?>

            <div class="postbox" style="max-width: 1100px; margin: 20px 0;">
                <div class="postbox-header">
                    <h2 class="hndle"><?php esc_html_e('Send Broadcast', 'andrew-writing-journal-newsletter'); ?></h2>
                </div>
                <div class="inside">
                    <p><?php esc_html_e('This uses wp_mail and sends one email per active subscriber so each message can include a unique unsubscribe link. Keep this for small to moderate lists.', 'andrew-writing-journal-newsletter'); ?></p>
                    <p><?php esc_html_e('Available placeholders: {{first_name}}, {{last_name}}, {{email}}, {{unsubscribe_url}}', 'andrew-writing-journal-newsletter'); ?></p>
                    <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                        <input type="hidden" name="action" value="awjn_send_broadcast">
                        <?php wp_nonce_field(self::SEND_NONCE_ACTION, 'awjn_send_nonce'); ?>
                        <table class="form-table" role="presentation">
                            <tbody>
                                <tr>
                                    <th scope="row"><label for="awjn_subject"><?php esc_html_e('Subject', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td><input class="regular-text" id="awjn_subject" name="subject" type="text" required></td>
                                </tr>
                                <tr>
                                    <th scope="row"><label for="awjn_body"><?php esc_html_e('Message', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td>
                                        <textarea id="awjn_body" name="body" rows="12" class="large-text code" required></textarea>
                                        <p class="description"><?php esc_html_e('Basic HTML is allowed. An unsubscribe footer is appended automatically.', 'andrew-writing-journal-newsletter'); ?></p>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row"><label for="awjn_limit"><?php esc_html_e('Recipient Limit', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td>
                                        <input id="awjn_limit" name="recipient_limit" type="number" min="0" step="1" value="0">
                                        <p class="description"><?php esc_html_e('Use 0 to send to all active subscribers. Set a smaller number if you want to send in batches.', 'andrew-writing-journal-newsletter'); ?></p>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <?php submit_button(__('Send Broadcast', 'andrew-writing-journal-newsletter')); ?>
                    </form>

                    <hr>

                    <h3><?php esc_html_e('Send Test Email', 'andrew-writing-journal-newsletter'); ?></h3>
                    <p><?php esc_html_e('Send the current message format to yourself before broadcasting to the list.', 'andrew-writing-journal-newsletter'); ?></p>
                    <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                        <input type="hidden" name="action" value="awjn_send_test">
                        <?php wp_nonce_field(self::TEST_NONCE_ACTION, 'awjn_test_nonce'); ?>
                        <table class="form-table" role="presentation">
                            <tbody>
                                <tr>
                                    <th scope="row"><label for="awjn_test_email"><?php esc_html_e('Test Email Address', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td><input class="regular-text" id="awjn_test_email" name="test_email" type="email" required></td>
                                </tr>
                                <tr>
                                    <th scope="row"><label for="awjn_test_subject"><?php esc_html_e('Subject', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td><input class="regular-text" id="awjn_test_subject" name="subject" type="text" required></td>
                                </tr>
                                <tr>
                                    <th scope="row"><label for="awjn_test_body"><?php esc_html_e('Message', 'andrew-writing-journal-newsletter'); ?></label></th>
                                    <td>
                                        <textarea id="awjn_test_body" name="body" rows="10" class="large-text code" required></textarea>
                                        <p class="description"><?php esc_html_e('The test email uses sample placeholder values and appends the unsubscribe footer.', 'andrew-writing-journal-newsletter'); ?></p>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <?php submit_button(__('Send Test Email', 'andrew-writing-journal-newsletter'), 'secondary', 'submit', false); ?>
                    </form>
                </div>
            </div>

            <div class="postbox" style="max-width: 1100px; margin: 20px 0;">
                <div class="postbox-header">
                    <h2 class="hndle"><?php esc_html_e('Campaign History', 'andrew-writing-journal-newsletter'); ?></h2>
                </div>
                <div class="inside">
                    <table class="widefat striped">
                        <thead>
                            <tr>
                                <th><?php esc_html_e('Date', 'andrew-writing-journal-newsletter'); ?></th>
                                <th><?php esc_html_e('Mode', 'andrew-writing-journal-newsletter'); ?></th>
                                <th><?php esc_html_e('Subject', 'andrew-writing-journal-newsletter'); ?></th>
                                <th><?php esc_html_e('Sent', 'andrew-writing-journal-newsletter'); ?></th>
                                <th><?php esc_html_e('Failed', 'andrew-writing-journal-newsletter'); ?></th>
                                <th><?php esc_html_e('Limit/Test', 'andrew-writing-journal-newsletter'); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php if (empty($campaigns)) : ?>
                                <tr>
                                    <td colspan="6"><?php esc_html_e('No campaigns sent yet.', 'andrew-writing-journal-newsletter'); ?></td>
                                </tr>
                            <?php else : ?>
                                <?php foreach ($campaigns as $campaign) : ?>
                                    <tr>
                                        <td><?php echo esc_html($campaign->sent_at); ?></td>
                                        <td><?php echo esc_html($campaign->mode); ?></td>
                                        <td><?php echo esc_html($campaign->subject); ?></td>
                                        <td><?php echo esc_html((string) $campaign->sent_count); ?></td>
                                        <td><?php echo esc_html((string) $campaign->failed_count); ?></td>
                                        <td><?php echo esc_html($campaign->mode === 'test' ? $campaign->test_email : (string) $campaign->recipient_limit); ?></td>
                                    </tr>
                                <?php endforeach; ?>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>

            <p>
                <a class="button button-primary" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=awjn_export_csv'), self::EXPORT_NONCE_ACTION)); ?>">
                    <?php esc_html_e('Export CSV', 'andrew-writing-journal-newsletter'); ?>
                </a>
            </p>

            <table class="widefat striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Email', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Name', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Interest', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Status', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Source', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Date', 'andrew-writing-journal-newsletter'); ?></th>
                        <th><?php esc_html_e('Note', 'andrew-writing-journal-newsletter'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($subscribers)) : ?>
                        <tr>
                            <td colspan="7"><?php esc_html_e('No subscribers yet.', 'andrew-writing-journal-newsletter'); ?></td>
                        </tr>
                    <?php else : ?>
                        <?php foreach ($subscribers as $subscriber) : ?>
                            <tr>
                                <td><?php echo esc_html($subscriber->email); ?></td>
                                <td><?php echo esc_html(trim($subscriber->first_name . ' ' . $subscriber->last_name)); ?></td>
                                <td><?php echo esc_html($subscriber->interest); ?></td>
                                <td><?php echo esc_html($subscriber->status); ?></td>
                                <td><?php echo esc_html($subscriber->source); ?></td>
                                <td><?php echo esc_html($subscriber->created_at); ?></td>
                                <td><?php echo esc_html($subscriber->note); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    public function handle_send_broadcast() {
        $this->ensure_schema_loaded();

        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to send broadcasts.', 'andrew-writing-journal-newsletter'));
        }

        check_admin_referer(self::SEND_NONCE_ACTION, 'awjn_send_nonce');

        $subject = isset($_POST['subject']) ? sanitize_text_field(wp_unslash($_POST['subject'])) : '';
        $body_template = isset($_POST['body']) ? wp_kses_post(wp_unslash($_POST['body'])) : '';
        $recipient_limit = isset($_POST['recipient_limit']) ? absint(wp_unslash($_POST['recipient_limit'])) : 0;

        if ($subject === '' || trim(wp_strip_all_tags($body_template)) === '') {
            $this->redirect_admin_with_status('broadcast_invalid');
        }

        global $wpdb;

        $table_name = self::table_name();
        $limit_sql = $recipient_limit > 0 ? $wpdb->prepare(' LIMIT %d', $recipient_limit) : '';
        $subscribers = $wpdb->get_results(
            $wpdb->prepare("SELECT id, email, first_name, last_name, unsubscribe_token FROM {$table_name} WHERE status = %s ORDER BY created_at DESC{$limit_sql}", 'subscribed')
        );

        if (empty($subscribers)) {
            $this->redirect_admin_with_status('broadcast_empty');
        }

        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $site_name = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $sent = 0;
        $failed = 0;

        foreach ($subscribers as $subscriber) {
            $unsubscribe_token = !empty($subscriber->unsubscribe_token) ? $subscriber->unsubscribe_token : self::generate_token();

            if (empty($subscriber->unsubscribe_token)) {
                $wpdb->update(
                    $table_name,
                    ['unsubscribe_token' => $unsubscribe_token],
                    ['id' => (int) $subscriber->id]
                );
            }

            $unsubscribe_url = add_query_arg(self::UNSUBSCRIBE_PARAM, $unsubscribe_token, home_url('/'));
            $replacements = [
                '{{first_name}}' => esc_html($subscriber->first_name !== '' ? $subscriber->first_name : 'Reader'),
                '{{last_name}}' => esc_html($subscriber->last_name),
                '{{email}}' => esc_html($subscriber->email),
                '{{unsubscribe_url}}' => esc_url($unsubscribe_url),
            ];

            $message = $this->render_email_template(
                $subject,
                strtr($body_template, $replacements),
                $unsubscribe_url,
                array(
                    'recipient_name' => trim($subscriber->first_name . ' ' . $subscriber->last_name),
                    'site_name' => $site_name,
                )
            );

            $result = wp_mail($subscriber->email, $subject, $message, $headers);
            if ($result) {
                $sent++;
            } else {
                $failed++;
            }
        }

        $this->record_campaign([
            'subject' => $subject,
            'body' => $body_template,
            'sent_count' => $sent,
            'failed_count' => $failed,
            'recipient_limit' => $recipient_limit,
            'test_email' => '',
            'mode' => 'broadcast',
            'created_by' => get_current_user_id(),
            'sent_at' => current_time('mysql'),
        ]);

        $this->redirect_admin_with_status('broadcast_sent', ['sent' => $sent, 'failed' => $failed]);
    }

    public function handle_send_test() {
        $this->ensure_schema_loaded();

        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to send test emails.', 'andrew-writing-journal-newsletter'));
        }

        check_admin_referer(self::TEST_NONCE_ACTION, 'awjn_test_nonce');

        $test_email = isset($_POST['test_email']) ? sanitize_email(wp_unslash($_POST['test_email'])) : '';
        $subject = isset($_POST['subject']) ? sanitize_text_field(wp_unslash($_POST['subject'])) : '';
        $body_template = isset($_POST['body']) ? wp_kses_post(wp_unslash($_POST['body'])) : '';

        if ($test_email === '' || !is_email($test_email) || $subject === '' || trim(wp_strip_all_tags($body_template)) === '') {
            $this->redirect_admin_with_status('test_invalid');
        }

        $unsubscribe_url = add_query_arg(self::UNSUBSCRIBE_PARAM, 'test-unsubscribe-token', home_url('/'));
        $replacements = [
            '{{first_name}}' => 'Andrew',
            '{{last_name}}' => 'Reader',
            '{{email}}' => $test_email,
            '{{unsubscribe_url}}' => esc_url($unsubscribe_url),
        ];

        $message = $this->render_email_template(
            $subject,
            strtr($body_template, $replacements),
            $unsubscribe_url,
            array(
                'recipient_name' => 'Andrew Reader',
                'site_name' => wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES),
                'is_test' => true,
            )
        );

        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $result = wp_mail($test_email, $subject, $message, $headers);

        $this->record_campaign([
            'subject' => $subject,
            'body' => $body_template,
            'sent_count' => $result ? 1 : 0,
            'failed_count' => $result ? 0 : 1,
            'recipient_limit' => 1,
            'test_email' => $test_email,
            'mode' => 'test',
            'created_by' => get_current_user_id(),
            'sent_at' => current_time('mysql'),
        ]);

        $this->redirect_admin_with_status($result ? 'test_sent' : 'test_failed', ['sent' => $result ? 1 : 0, 'failed' => $result ? 0 : 1]);
    }

    public function handle_unsubscribe_request() {
        if (is_admin() || !isset($_GET[self::UNSUBSCRIBE_PARAM])) {
            return;
        }

        $this->ensure_schema_loaded();

        $token = sanitize_text_field(wp_unslash($_GET[self::UNSUBSCRIBE_PARAM]));
        if ($token === '') {
            $this->render_unsubscribe_page(false, __('That unsubscribe link is invalid.', 'andrew-writing-journal-newsletter'));
        }

        if ($token === 'test-unsubscribe-token') {
            $this->render_unsubscribe_page(true, __('This was a test unsubscribe link from a preview email. Real broadcast emails will unsubscribe the matching subscriber correctly.', 'andrew-writing-journal-newsletter'));
        }

        global $wpdb;

        $table_name = self::table_name();
        $subscriber = $wpdb->get_row(
            $wpdb->prepare("SELECT id, email, status FROM {$table_name} WHERE unsubscribe_token = %s LIMIT 1", $token)
        );

        if (!$subscriber) {
            $this->render_unsubscribe_page(false, __('That unsubscribe link is invalid or expired.', 'andrew-writing-journal-newsletter'));
        }

        if ($subscriber->status === 'unsubscribed') {
            $this->render_unsubscribe_page(true, __('This email address is already unsubscribed.', 'andrew-writing-journal-newsletter'));
        }

        $now = current_time('mysql');
        $wpdb->update(
            $table_name,
            [
                'status' => 'unsubscribed',
                'unsubscribed_at' => $now,
                'updated_at' => $now,
            ],
            ['id' => (int) $subscriber->id]
        );

        $this->render_unsubscribe_page(true, sprintf(__('The address %s has been unsubscribed from Andrew\'s Writing Journal.', 'andrew-writing-journal-newsletter'), $subscriber->email));
    }

    public function export_csv() {
        $this->ensure_schema_loaded();

        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to export subscribers.', 'andrew-writing-journal-newsletter'));
        }

        check_admin_referer(self::EXPORT_NONCE_ACTION);

        global $wpdb;

        $table_name = self::table_name();
        $rows = $wpdb->get_results("SELECT email, first_name, last_name, interest, note, source, status, unsubscribed_at, created_at, updated_at FROM {$table_name} ORDER BY created_at DESC", ARRAY_A);

        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=andrew-writing-journal-subscribers-' . gmdate('Y-m-d') . '.csv');

        $output = fopen('php://output', 'wb');
        if ($output === false) {
            wp_die(esc_html__('Unable to create export file.', 'andrew-writing-journal-newsletter'));
        }

        fputcsv($output, ['email', 'first_name', 'last_name', 'interest', 'note', 'source', 'status', 'unsubscribed_at', 'created_at', 'updated_at']);

        foreach ($rows as $row) {
            fputcsv($output, $row);
        }

        fclose($output);
        exit;
    }

    private function status_message($status) {
        $messages = [
            'success' => [
                'type' => 'success',
                'text' => __('You are on the list. Future writing updates will come from this site.', 'andrew-writing-journal-newsletter'),
            ],
            'updated' => [
                'type' => 'success',
                'text' => __('Your subscription details were updated.', 'andrew-writing-journal-newsletter'),
            ],
            'invalid_submission' => [
                'type' => 'error',
                'text' => __('Please provide a valid email address.', 'andrew-writing-journal-newsletter'),
            ],
            'invalid_nonce' => [
                'type' => 'error',
                'text' => __('Your session expired. Please try again.', 'andrew-writing-journal-newsletter'),
            ],
            'save_failed' => [
                'type' => 'error',
                'text' => __('The subscription could not be saved. Please try again.', 'andrew-writing-journal-newsletter'),
            ],
            'spam_blocked' => [
                'type' => 'error',
                'text' => __('The submission could not be accepted.', 'andrew-writing-journal-newsletter'),
            ],
        ];

        return $messages[$status] ?? null;
    }

    private function admin_status_message($status) {
        $sent = isset($_GET['sent']) ? absint(wp_unslash($_GET['sent'])) : 0;
        $failed = isset($_GET['failed']) ? absint(wp_unslash($_GET['failed'])) : 0;

        if ($status === 'broadcast_sent') {
            return [
                'type' => $failed > 0 ? 'warning' : 'success',
                'text' => sprintf(__('Broadcast complete. Sent: %1$d. Failed: %2$d.', 'andrew-writing-journal-newsletter'), $sent, $failed),
            ];
        }

        $messages = [
            'broadcast_invalid' => [
                'type' => 'error',
                'text' => __('Enter both a subject and a message before sending.', 'andrew-writing-journal-newsletter'),
            ],
            'broadcast_empty' => [
                'type' => 'warning',
                'text' => __('There are no active subscribers to email.', 'andrew-writing-journal-newsletter'),
            ],
            'test_invalid' => [
                'type' => 'error',
                'text' => __('Enter a valid test email, subject, and message before sending.', 'andrew-writing-journal-newsletter'),
            ],
            'test_sent' => [
                'type' => 'success',
                'text' => __('Test email sent successfully.', 'andrew-writing-journal-newsletter'),
            ],
            'test_failed' => [
                'type' => 'error',
                'text' => __('The test email could not be sent. Check your WordPress mail configuration.', 'andrew-writing-journal-newsletter'),
            ],
        ];

        return $messages[$status] ?? null;
    }

    private function redirect_with_status($status) {
        $redirect = wp_get_referer();
        if (!$redirect) {
            $redirect = home_url('/');
        }

        $redirect = remove_query_arg(self::STATUS_PARAM, $redirect);
        wp_safe_redirect(add_query_arg(self::STATUS_PARAM, $status, $redirect));
        exit;
    }

    private function redirect_admin_with_status($status, $extra = array()) {
        $redirect = admin_url('admin.php?page=awjn-subscribers');
        $args = array_merge([self::ADMIN_STATUS_PARAM => $status], $extra);
        wp_safe_redirect(add_query_arg($args, $redirect));
        exit;
    }

    private function request_ip() {
        $keys = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];

        foreach ($keys as $key) {
            if (!empty($_SERVER[$key])) {
                $value = sanitize_text_field(wp_unslash($_SERVER[$key]));
                $candidate = trim(explode(',', $value)[0]);
                if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                    return $candidate;
                }
            }
        }

        return '';
    }

    private function render_unsubscribe_page($success, $message) {
        status_header($success ? 200 : 400);
        nocache_headers();

        $home = home_url('/');
        ?>
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title><?php echo esc_html(get_bloginfo('name')); ?> - <?php esc_html_e('Subscription Update', 'andrew-writing-journal-newsletter'); ?></title>
            <style>
                body {
                    margin: 0;
                    min-height: 100vh;
                    display: grid;
                    place-items: center;
                    background: linear-gradient(180deg, #211610 0%, #120d0a 100%);
                    color: #f2e4cb;
                    font-family: Georgia, serif;
                }
                .awjn-unsub-wrap {
                    max-width: 640px;
                    margin: 24px;
                    padding: 32px;
                    border-radius: 24px;
                    background: rgba(23, 16, 13, 0.94);
                    border: 1px solid rgba(230, 205, 170, 0.14);
                    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
                }
                .awjn-unsub-wrap h1 {
                    margin-top: 0;
                    font-size: 2.4rem;
                    line-height: 1.05;
                }
                .awjn-unsub-wrap p {
                    line-height: 1.75;
                    color: #dcc8a9;
                }
                .awjn-unsub-wrap a {
                    display: inline-block;
                    margin-top: 12px;
                    padding: 12px 16px;
                    border-radius: 999px;
                    text-decoration: none;
                    color: #140f0d;
                    background: linear-gradient(180deg, #cda468, #b27d3d);
                    font-family: Verdana, sans-serif;
                    font-size: 0.8rem;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                }
            </style>
        </head>
        <body>
            <main class="awjn-unsub-wrap">
                <h1><?php echo esc_html($success ? __('Subscription Updated', 'andrew-writing-journal-newsletter') : __('Unable to Update Subscription', 'andrew-writing-journal-newsletter')); ?></h1>
                <p><?php echo esc_html($message); ?></p>
                <a href="<?php echo esc_url($home); ?>"><?php esc_html_e('Return to Site', 'andrew-writing-journal-newsletter'); ?></a>
            </main>
        </body>
        </html>
        <?php
        exit;
    }

    private function record_campaign($campaign) {
        global $wpdb;

        $wpdb->insert(self::campaign_table_name(), $campaign);
    }

    private function render_email_template($subject, $body_content, $unsubscribe_url, $options = array()) {
        $copy = $this->get_page_copy_settings();
        $site_name = isset($options['site_name']) ? $options['site_name'] : wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $recipient_name = isset($options['recipient_name']) && $options['recipient_name'] !== '' ? $options['recipient_name'] : 'Reader';
        $is_test = !empty($options['is_test']);
        $intro = $is_test
            ? 'This is a preview of your Writing Journal broadcast email.'
            : $copy['email_intro'];
        $body_html = wpautop(wp_kses_post($body_content));

        ob_start();
        ?>
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title><?php echo esc_html($subject); ?></title>
        </head>
        <body style="margin:0;padding:0;background-color:#120d0a;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:linear-gradient(180deg,#211610 0%,#120d0a 100%);margin:0;padding:24px 0;width:100%;">
                <tr>
                    <td align="center" style="padding:0 16px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;width:100%;background:#1a1310;border:1px solid #3c2c21;border-radius:20px;overflow:hidden;">
                            <tr>
                                <td style="padding:0;background:radial-gradient(circle at top,#7f5424 0%,#2a1c15 38%,#1a1310 100%);">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="padding:32px 32px 24px 32px;color:#f3e7d2;">
                                                <div style="font-family:Verdana,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#d6bd99;margin-bottom:12px;"><?php echo esc_html($copy['email_kicker']); ?></div>
                                                <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.08;color:#fff4df;font-weight:normal;"><?php echo esc_html($copy['email_title']); ?></h1>
                                                <p style="margin:14px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.7;color:#ead9bf;">
                                                    <?php echo esc_html($intro); ?>
                                                </p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:28px 32px 12px 32px;background:#f3e7d2;color:#261b13;">
                                    <p style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.7;color:#4d3b2d;">
                                        <?php echo esc_html('Hello ' . $recipient_name . ','); ?>
                                    </p>
                                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.8;color:#261b13;">
                                        <?php echo $body_html; ?>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:0 32px 32px 32px;background:#f3e7d2;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #d7c7af;margin-top:8px;">
                                        <tr>
                                            <td style="padding-top:18px;font-family:Verdana,Arial,sans-serif;font-size:13px;line-height:1.7;color:#5d4a39;">
                                                <p style="margin:0 0 10px 0;"><?php echo esc_html($copy['email_footer']); ?></p>
                                                <p style="margin:0;">If you no longer want these emails, <a href="<?php echo esc_url($unsubscribe_url); ?>" style="color:#8b5a23;text-decoration:underline;">unsubscribe here</a>.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        <?php

        return (string) ob_get_clean();
    }

    private function ensure_schema_loaded() {
        $installed = get_option('awjn_db_version');
        if ($installed !== self::VERSION) {
            self::activate();
        }
    }

    private function get_page_copy_settings() {
        $defaults = $this->get_page_copy_defaults();
        $saved = get_option(self::SETTINGS_OPTION, array());

        if (!is_array($saved)) {
            $saved = array();
        }

        return wp_parse_args($saved, $defaults);
    }

    private function get_page_copy_defaults() {
        return array(
            'title' => "Join Andrew's Writing Journal",
            'subtitle' => 'Get fiction updates, journal entries, and behind-the-scenes notes from ongoing projects.',
            'point_1_label' => 'In Your Inbox',
            'point_1_text' => 'New journal posts, writing progress, and story developments from ongoing projects.',
            'point_2_label' => 'Fiction + Process',
            'point_2_text' => 'Notes on fantasy fiction, worldbuilding, continuity, and whatever is taking shape next.',
            'point_3_label' => 'Selective Project News',
            'point_3_text' => 'Occasional updates on Extal and related tools when they connect to the writing itself.',
            'quote' => 'Keep up to date on fiction, journal posts, and the broader creative work without routing readers through a third-party list provider.',
            'panel_title' => 'Join the list.',
            'panel_intro' => 'Subscribers are stored directly in your WordPress database. No external mailing-list service is required.',
            'button_text' => 'Subscribe to the Journal',
            'link_1_label' => 'Secrets of Enali',
            'link_1_url' => 'https://andrewnusz.com/secrets-of-enali/',
            'link_2_label' => 'The Ansville Gatehouse',
            'link_2_url' => 'https://andrewnusz.com/ansville/',
            'link_3_label' => 'The Journal',
            'link_3_url' => 'https://andrewnusz.com/blog/',
            'link_4_label' => 'Extal World Builder',
            'link_4_url' => 'https://andrewnusz.com/extal-world-builder/',
            'email_kicker' => 'Andrew D Nusz',
            'email_title' => "Andrew's Writing Journal",
            'email_intro' => "You are receiving this because you subscribed to Andrew's Writing Journal.",
            'email_footer' => 'Sent from andrewnusz.com.',
        );
    }

    private function get_page_links($copy) {
        $links = array();

        for ($index = 1; $index <= 4; $index++) {
            $label_key = 'link_' . $index . '_label';
            $url_key = 'link_' . $index . '_url';
            $label = isset($copy[$label_key]) ? trim($copy[$label_key]) : '';
            $url = isset($copy[$url_key]) ? trim($copy[$url_key]) : '';

            if ($label !== '' && $url !== '') {
                $links[] = array(
                    'label' => $label,
                    'url' => $url,
                );
            }
        }

        return $links;
    }

    private function render_settings_preview($copy) {
        $links = $this->get_page_links($copy);
        ?>
        <div style="background:linear-gradient(180deg,#211610 0%,#120d0a 100%); border:1px solid #3c2c21; border-radius:24px; padding:24px; color:#f3e7d2; max-width:860px; box-shadow:0 20px 40px rgba(0,0,0,0.18);">
            <div style="font-family:Verdana,Arial,sans-serif; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#d6bd99; margin-bottom:12px;">Andrew D Nusz | Writing Journal</div>
            <h2 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:42px; line-height:1.02; color:#fff4df; font-weight:normal; max-width:12ch;"><?php echo esc_html($copy['title']); ?></h2>
            <p style="margin:16px 0 0 0; font-family:Georgia,'Times New Roman',serif; font-size:18px; line-height:1.8; color:#ead9bf; max-width:720px;"><?php echo esc_html($copy['subtitle']); ?></p>

            <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:24px;">
                <div style="padding:14px; border:1px solid rgba(255,227,191,0.12); border-radius:16px; background:rgba(255,248,235,0.05);">
                    <div style="font-family:Verdana,Arial,sans-serif; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#d8c4a6; margin-bottom:8px;"><?php echo esc_html($copy['point_1_label']); ?></div>
                    <div style="font-size:15px; line-height:1.6; color:#f0dec0;"><?php echo esc_html($copy['point_1_text']); ?></div>
                </div>
                <div style="padding:14px; border:1px solid rgba(255,227,191,0.12); border-radius:16px; background:rgba(255,248,235,0.05);">
                    <div style="font-family:Verdana,Arial,sans-serif; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#d8c4a6; margin-bottom:8px;"><?php echo esc_html($copy['point_2_label']); ?></div>
                    <div style="font-size:15px; line-height:1.6; color:#f0dec0;"><?php echo esc_html($copy['point_2_text']); ?></div>
                </div>
                <div style="padding:14px; border:1px solid rgba(255,227,191,0.12); border-radius:16px; background:rgba(255,248,235,0.05);">
                    <div style="font-family:Verdana,Arial,sans-serif; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#d8c4a6; margin-bottom:8px;"><?php echo esc_html($copy['point_3_label']); ?></div>
                    <div style="font-size:15px; line-height:1.6; color:#f0dec0;"><?php echo esc_html($copy['point_3_text']); ?></div>
                </div>
            </div>

            <div style="margin-top:20px; padding:18px 20px; border-left:3px solid #cda468; border-radius:0 14px 14px 0; background:rgba(255,248,235,0.06); font-family:Georgia,'Times New Roman',serif; font-size:18px; line-height:1.7; color:#f3e6d0;"><?php echo esc_html($copy['quote']); ?></div>

            <?php if (!empty($links)) : ?>
                <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:18px;">
                    <?php foreach ($links as $link) : ?>
                        <span style="display:inline-flex; align-items:center; padding:9px 12px; border-radius:999px; background:rgba(255,248,235,0.06); border:1px solid rgba(255,227,191,0.16); color:#f0dec0; font-family:Verdana,Arial,sans-serif; font-size:11px; letter-spacing:0.08em; text-transform:uppercase;"><?php echo esc_html($link['label']); ?></span>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>

            <div style="margin-top:24px; max-width:360px; padding:20px; border-radius:20px; background:linear-gradient(180deg, rgba(244,234,216,0.98), rgba(231,214,188,0.96)); color:#261b13; box-shadow:0 18px 36px rgba(0,0,0,0.18);">
                <div style="font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.08; color:#261b13; margin-bottom:10px;"><?php echo esc_html($copy['panel_title']); ?></div>
                <div style="font-size:15px; line-height:1.7; color:#5d4a39;"><?php echo esc_html($copy['panel_intro']); ?></div>
            </div>
        </div>
        <?php
    }

    private static function generate_token() {
        return wp_generate_password(48, false, false);
    }

    private static function table_name() {
        global $wpdb;
        return $wpdb->prefix . self::TABLE_SLUG;
    }

    private static function campaign_table_name() {
        global $wpdb;
        return $wpdb->prefix . self::CAMPAIGN_TABLE_SLUG;
    }
}

register_activation_hook(__FILE__, ['Andrew_Writing_Journal_Newsletter', 'activate']);
Andrew_Writing_Journal_Newsletter::bootstrap();