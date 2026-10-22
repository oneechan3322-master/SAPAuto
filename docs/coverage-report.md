# Data Coverage Report — 2026-10-22 19:30:44 (task B0)

Database: C:\Users\Mega Store\Downloads\SapAuto\v8.1\data\sapauto.db · tables: 44 · code files scanned: 87

## schema_migrations (33 rows) — internal

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| name | 100% | "001_core.sql" | name,tableInQuery |
| applied_at | 100% | "2026-10-11T22:00:17.855Z" | tableInQuery |
| checksum | 100% | "8d09dff874f05ffc03304e631c66f7f9a60bf40aa18ed062a8507e6c2b7f" | name,tableInQuery |

## companies (26 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "company_029139f708176ed5462d49e9" | name,tableInQuery |
| name | 100% | "احمد صابر محمد ابوالقمصان كيمورا للبويات و الصناعات الكيماوي" | name,tableInQuery |
| account_key | 100% | "205971997" | name,tableInQuery |
| external_ref | 100% | "" | tableInQuery |
| status | 100% | "ready" | name,tableInQuery |
| last_scanned_at | 92% | "2026-10-19T12:14:29.763Z" | tableInQuery |
| source_updated_at | 0% | null | tableInQuery |
| raw_json | 100% | "{}" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:13:26.949Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-19T12:14:29.763Z" | name,tableInQuery |
| english_name | 100% | "" | name,tableInQuery |
| tax_registration_number | 100% | "" | name,tableInQuery |
| name_source | 100% | "source" | name,tableInQuery |
| portal_name | 100% | "المجموعه المتحده للزيوت والدهانات يونايتد احمد صابر محمد وشر" | name,tableInQuery |
| portal_name_english | 100% | "" | tableInQuery |

## tasks (196 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "tasks_01d48061662af938a1ef2a58" | name,tableInQuery |
| company_id | 100% | "company_029139f708176ed5462d49e9" | name,tableInQuery |
| account_key | 100% | "205971997" | name,tableInQuery |
| doc_number | 100% | "180000179526" | name,tableInQuery |
| title | 100% | "نموذج ١٩ دمغة/ ١٩ دمغة مكرر - 180000209907" | name,tableInQuery |
| deadline | 100% | "2025-10-23" | name,tableInQuery |
| status | 100% | "done" | name,tableInQuery |
| urgency | 100% | "overdue" | name,tableInQuery |
| required_action | 100% | "مراجعة التقدير والنموذج الضريبي وإعداد مذكرة الدفاع أو الطعن" | name,tableInQuery |
| assigned_to | 100% | "المستشار الضريبي" | tableInQuery |
| pdf_path | 100% | "c:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\\data\\pdfs\\نموذج ١٩ " | name,tableInQuery |
| origin | 100% | "portal" | name,tableInQuery |
| raw_json | 100% | "{\"id\":\"marwanhamada::180000209907::10/09/2026::نموذج ١٩ دمغة" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:13:26.954Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-19T12:14:29.764Z" | name,tableInQuery |
| local_review_status | 100% | "completed_locally" | tableInQuery |
| local_review_note | 100% | "" | tableInQuery |
| local_reviewed_at | 2% | "2026-10-14T17:13:26.954Z" | tableInQuery |
| local_reviewed_by | 100% | "" | tableInQuery |
| ai_study | 100% | "📋 المستند المطلوب: نموذج 19 ومذكرة الدفاع والطعن القانوني و" | tableInQuery |
| ai_studied_at | 73% | "2026-10-17T18:39:15.323Z" | tableInQuery |

## obligations (800 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "obligations_00075a9599ca1b9e05ca2c5e" | name,tableInQuery |
| company_id | 100% | "company_029139f708176ed5462d49e9" | name,tableInQuery |
| account_key | 100% | "205971997" | name,tableInQuery |
| obligation_code | 100% | "205971997::CIT::0000-12-30_إلى_9999-12-31::20280102::البطاقة" | name,tableInQuery |
| period | 100% | "0000-12-30 إلى 9999-12-31" | name,tableInQuery |
| title | 100% | "نموذج ١٩ دمغة/ ١٩ دمغة مكرر -" | name,tableInQuery |
| deadline | 100% | "" | name,tableInQuery |
| status | 100% | "overdue" | name,tableInQuery |
| penalty_band | 100% | "not_late" | tableInQuery |
| evidence | 100% | "" | name,tableInQuery |
| raw_json | 100% | "{\"id\":\"marwanhamada::PORTAL_FILING::نموذج_١٩_دمغة_١٩_دمغة_مك" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:13:26.958Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-19T12:14:29.766Z" | name,tableInQuery |
| local_review_status | 100% | "not_reviewed" | tableInQuery |
| local_review_note | 100% | "" | tableInQuery |
| local_reviewed_at | 0% | null | tableInQuery |
| local_reviewed_by | 100% | "" | tableInQuery |
| ai_study | 100% | "" | tableInQuery |
| ai_risk_score | 100% | "" | tableInQuery |
| ai_studied_at | 27% | "2026-10-19T12:15:29.819Z" | tableInQuery |
| required_doc | 100% | "" | tableInQuery |
| legal_days | 3% | "15" | tableInQuery |
| respond_by | 3% | "2026-03-29" | tableInQuery |
| deadline_basis | 100% | "" | tableInQuery |
| anchor_mode | 100% | "" | tableInQuery |
| absent_scan_streak | 100% | "0" | tableInQuery |
| review_state | 0% | null | tableInQuery |
| review_note | 100% | "" | tableInQuery |
| review_updated_at | 100% | "" | tableInQuery |
| review_updated_by | 100% | "" | tableInQuery |

## payments (942 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "payments_0017d24f7d5f9867538854d1" | name,tableInQuery |
| company_id | 100% | "company_f2c66b9ff672031dac1b14ad" | name,tableInQuery |
| account_key | 100% | "205971997" | name,tableInQuery |
| claim_number | 100% | "000020899994" | name,tableInQuery |
| amount | 100% | "16666" | name,tableInQuery |
| currency | 100% | "الجنيه المصري (EGP)" | name,tableInQuery |
| due_date | 100% | "2002-12-31" | name,tableInQuery |
| status | 100% | "في انتظار السداد" | name,tableInQuery |
| raw_json | 100% | "{\"id\":\"90639::000170695538\",\"companyId\":\"90639\",\"companyKey\"" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:13:26.959Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-19T12:14:29.768Z" | name,tableInQuery |
| local_review_status | 100% | "not_reviewed" | tableInQuery |
| local_paid_at | 0% | null | tableInQuery |
| local_paid_reason | 100% | "" | tableInQuery |
| source_observed_at | 100% | "2026-10-19T12:14:29.304Z" | tableInQuery |
| source_stale | 100% | "0" | tableInQuery |
| absent_scan_streak | 100% | "0" | tableInQuery |
| review_state | 0% | null | tableInQuery |

## messages (520 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "messages_00c41acb056d76b29753a25a" | name,tableInQuery |
| company_id | 100% | "company_f2c66b9ff672031dac1b14ad" | name,tableInQuery |
| account_key | 100% | "205971997" | name,tableInQuery |
| portal_message_id | 100% | "205971997::msg::1" | tableInQuery |
| title | 100% | "نموذج ١٩ دمغة/ ١٩ دمغة مكرر - 180000209907 10‏/09‏/2026" | name,tableInQuery |
| body | 100% | "" | name,tableInQuery |
| severity | 100% | "معلومات" | name,tableInQuery |
| received_at | 0% | null | name,tableInQuery |
| is_read | 100% | "0" | tableInQuery |
| raw_json | 100% | "{\"id\":\"marwanhamada::msg::1\",\"portalMessageId\":\"marwanhamada" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:14:31.544Z" | name,tableInQuery |
| ai_study | 100% | "📋 المستند المطلوب: مراجعة إشعار مصلحة الضرائب (نموذج ١٩ دمغ" | tableInQuery |
| ai_action_required | 100% | "إجراء عاجل مطلوب" | tableInQuery |
| ai_studied_at | 40% | "2026-10-19T10:57:29.586Z" | tableInQuery |

## automation_cycles (12 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "cycle_19f535ee-4422-42a4-b997-d56bb2a703d8" | name,tableInQuery |
| started_at | 100% | "2026-10-14T17:12:21.191Z" | tableInQuery |
| finished_at | 100% | "2026-10-14T17:15:34.851Z" | tableInQuery |
| state | 100% | "done" | name,tableInQuery |
| accounts_total | 100% | "26" | tableInQuery |
| accounts_processed | 100% | "3" | tableInQuery |
| accounts_failed | 100% | "0" | tableInQuery |
| summary | 100% | "{\"accountKey\":null}" | name,tableInQuery |

## audit_log (289 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "audit_0088505b-a772-420a-a374-06a23a5c457a" | name,tableInQuery |
| at | 100% | "2026-10-14T17:11:25.775Z" | name,tableInQuery |
| actor_id | 100% | "10582167-8d95-45f9-aa06-7b04614c0dc1" | tableInQuery |
| action | 100% | "assistant.message.started" | name,tableInQuery |
| entity_type | 100% | "assistant" | tableInQuery |
| entity_id | 100% | "" | name,tableInQuery |
| details | 100% | "{\"role\":\"Owner\"}" | name,tableInQuery |

## harness_status (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "1" | name,tableInQuery |
| state | 100% | "idle" | name,tableInQuery |
| current_account | 100% | "" | name,tableInQuery |
| account_index | 100% | "0" | name,tableInQuery |
| account_total | 100% | "1" | name,tableInQuery |
| last_heartbeat | 100% | "2026-10-22T18:20:59.089Z" | name,tableInQuery |
| next_cycle_at | 0% | null | name,tableInQuery |
| paused | 100% | "0" | name,tableInQuery |
| updated_at | 100% | "2026-10-22T18:21:26.381Z" | name,tableInQuery |

## commands (22 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "channel_test_29b2c761-98dd-49f2-974d-207fdbf56b0f" | name,tableInQuery |
| type | 100% | "scan_now" | name,tableInQuery |
| payload | 100% | "{}" | name,tableInQuery |
| requested_by | 100% | "10582167-8d95-45f9-aa06-7b04614c0dc1" | name,tableInQuery |
| status | 100% | "done" | name,tableInQuery |
| result | 100% | "{\"cycleId\":\"cycle_2f87353d-2a26-4a27-bd73-f53359d56237\",\"pro" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:12:16.866Z" | name,tableInQuery |
| started_at | 100% | "2026-10-14T17:12:19.990Z" | tableInQuery |
| finished_at | 100% | "2026-10-14T17:15:34.851Z" | tableInQuery |

## account_status (26 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| account_key | 100% | "205971997" | name |
| state | 100% | "ready" | name |
| consecutive_failures | 100% | "0" | — |
| parked_until | 0% | null | — |
| last_success_at | 92% | "2026-10-19T12:14:29.763Z" | name |
| last_error | 100% | "" | name |
| updated_at | 100% | "2026-10-19T12:14:29.763Z" | name |

## failures (11 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "failure_0037a513-a0b4-41e7-acba-f691895b8ef6" | name,tableInQuery |
| account_key | 100% | "Bright-123" | name,tableInQuery |
| occurred_at | 100% | "2026-10-17T19:57:51.863Z" | name,tableInQuery |
| reason | 100% | "Portal rejected account authentication" | name,tableInQuery |
| hint | 100% | "راجع بيانات الدخول والاتصال، ثم أعد المحاولة بعد التحقق." | tableInQuery |
| resolved_at | 0% | null | name,tableInQuery |
| resolved_by | 100% | "" | tableInQuery |
| company_id | 0% | null | name,tableInQuery |

## events (1720 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "068681cd-127b-44fd-849d-2871b66b9ab6" | name,tableInQuery |
| kind | 100% | "new_doc" | name,tableInQuery |
| account_key | 100% | "marwanhamada" | name,tableInQuery |
| entity_id | 100% | "180000157240" | name,tableInQuery |
| payload | 100% | "{\"doc_number\":\"180000157240\",\"title\":\"إخطار تجهيز مستندات - " | name,tableInQuery |
| announced | 100% | "0" | tableInQuery |
| created_at | 100% | "2026-10-14T17:13:26.949Z" | name,tableInQuery |

## users (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "8f564630-d269-4dcd-9b7e-a03d033abf06" | name,tableInQuery |
| name | 100% | "Admin" | name,tableInQuery |
| email | 100% | "admin@office.local" | name,tableInQuery |
| emailVerified | 100% | "0" | tableInQuery |
| image | 0% | null | tableInQuery |
| createdAt | 100% | "2026-10-16T18:09:26.212Z" | tableInQuery |
| updatedAt | 100% | "2026-10-16T18:09:26.212Z" | tableInQuery |
| role | 100% | "Owner" | name,tableInQuery |
| disabled | 100% | "0" | name,tableInQuery |

## sessions (13 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "152ae119-eb44-4dfa-aea0-0ca916f3f5fa" | name |
| expiresAt | 100% | "2026-10-17T06:09:26.245Z" | — |
| token | 100% | "0sQxq8Uj6kupjrPkROtjFYEkf06vndjM" | name |
| createdAt | 100% | "2026-10-16T18:09:26.245Z" | — |
| updatedAt | 100% | "2026-10-16T18:09:26.245Z" | — |
| ipAddress | 100% | "127.0.0.1" | — |
| userAgent | 100% | "" | — |
| userId | 100% | "8f564630-d269-4dcd-9b7e-a03d033abf06" | — |

## user_accounts (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "a4f389a7-91a6-4ea7-8773-89322d4d403f" | name |
| accountId | 100% | "8f564630-d269-4dcd-9b7e-a03d033abf06" | — |
| providerId | 100% | "credential" | — |
| userId | 100% | "8f564630-d269-4dcd-9b7e-a03d033abf06" | — |
| accessToken | 0% | null | — |
| refreshToken | 0% | null | — |
| idToken | 0% | null | — |
| accessTokenExpiresAt | 0% | null | — |
| refreshTokenExpiresAt | 0% | null | — |
| scope | 0% | null | — |
| password | 100% | "5afac0fc162b64100134a2998f275e99:39f2ce2e2828a39984c395a6e3e" | name |
| createdAt | 100% | "2026-10-16T18:09:26.242Z" | — |
| updatedAt | 100% | "2026-10-16T18:09:26.242Z" | — |

## verification (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| identifier | 0% | null | — |
| value | 0% | null | name |
| expiresAt | 0% | null | — |
| createdAt | 0% | null | — |
| updatedAt | 0% | null | — |

## user_channels (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name,tableInQuery |
| user_id | 0% | null | name,tableInQuery |
| channel | 0% | null | name,tableInQuery |
| external_id | 0% | null | name,tableInQuery |
| verified_at | 0% | null | name,tableInQuery |

## link_codes (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| code_hash | 0% | null | tableInQuery |
| user_id | 0% | null | name,tableInQuery |
| expires_at | 0% | null | name,tableInQuery |
| used_at | 0% | null | name,tableInQuery |

## settings (33 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| key | 100% | "ai_allow_cloud" | name,tableInQuery |
| value | 100% | "120" | name,tableInQuery |
| updated_at | 100% | "2026-10-11 22:00:17" | name,tableInQuery |

## notes (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name,tableInQuery |
| target_type | 0% | null | name,tableInQuery |
| target_id | 0% | null | name,tableInQuery |
| user_id | 0% | null | name,tableInQuery |
| text | 0% | null | name,tableInQuery |
| created_at | 0% | null | name,tableInQuery |

## reminders (3 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "reminder_06e3b148-8b15-4885-8e9d-1b6e90905471" | name,tableInQuery |
| target_type | 100% | "obligation" | name,tableInQuery |
| target_id | 100% | "obligations_e093060f5745b0d8e592bd48" | name,tableInQuery |
| user_id | 100% | "8f564630-d269-4dcd-9b7e-a03d033abf06" | name,tableInQuery |
| due_at | 100% | "2026-10-17T20:00:09.042Z" | name,tableInQuery |
| channel | 100% | "launcher" | name,tableInQuery |
| dedupe_key | 100% | "obligations_5c74a4e0bda6e21472a46d1e:law:2026-03-29:overdue" | name,tableInQuery |
| sent_at | 0% | null | tableInQuery |
| cancelled_at | 0% | null | name,tableInQuery |
| created_at | 100% | "2026-10-17T20:00:09.042Z" | name,tableInQuery |
| message | 100% | "انتهت صلاحية بطاقة تعريف ضريبية منذ 202 يوماً — الموعد كان 2" | name,tableInQuery |
| delivery_status | 100% | "pending" | tableInQuery |
| company_id | 0% | null | name,tableInQuery |

## reports (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name,tableInQuery |
| user_id | 0% | null | name,tableInQuery |
| channel | 0% | null | name,tableInQuery |
| recipients | 0% | null | name,tableInQuery |
| body | 0% | null | name,tableInQuery |
| sent_at | 0% | null | tableInQuery |
| created_at | 0% | null | name,tableInQuery |
| delivery_status | 0% | null | tableInQuery |
| company_id | 0% | null | name,tableInQuery |

## ai_usage (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| provider | 0% | null | name |
| model | 0% | null | — |
| input_tokens | 0% | null | — |
| output_tokens | 0% | null | — |
| cost_usd | 0% | null | — |
| created_at | 0% | null | name |

## channel_deliveries (23 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| event_id | 100% | "068681cd-127b-44fd-849d-2871b66b9ab6" | name,tableInQuery |
| channel | 100% | "whatsapp" | name,tableInQuery |
| external_id | 100% | "201126170117@c.us" | name,tableInQuery |
| sent_at | 100% | "2026-10-19T10:20:24.934Z" | tableInQuery |
| status | 100% | "sent" | name,tableInQuery |

## assistant_manager_status (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "1" | name,tableInQuery |
| state | 100% | "online" | name,tableInQuery |
| last_run_at | 100% | "2026-10-22T18:21:13.851Z" | tableInQuery |
| last_error | 100% | "" | name,tableInQuery |
| updated_at | 100% | "2026-10-22T18:21:13.851Z" | name,tableInQuery |

## assistant_attention (1372 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "attention_0014b8476b9a735128a903dc" | name,tableInQuery |
| dedupe_key | 100% | "manager:failure:329724118" | name,tableInQuery |
| category | 100% | "harness_offline" | name,tableInQuery |
| title | 100% | "اخطار بالحضور لجلسة نظر الطعن نموذج رقم-730000012143 — موعد " | name,tableInQuery |
| details | 100% | "الموعد المسجل ٠٤‏/١١‏/٢٠٢٥" | name,tableInQuery |
| account_key | 100% | "marwanhamada" | name,tableInQuery |
| entity_id | 100% | "tasks_f58010b96f6e463191fab624" | name,tableInQuery |
| state | 100% | "cleared" | name,tableInQuery |
| created_at | 100% | "2026-10-14T17:13:46.706Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-20T00:37:52.059Z" | name,tableInQuery |

## assistant_confirmations (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name,tableInQuery |
| user_id | 0% | null | name,tableInQuery |
| tool_name | 0% | null | name,tableInQuery |
| args_json | 0% | null | name,tableInQuery |
| state | 0% | null | name,tableInQuery |
| created_at | 0% | null | name,tableInQuery |
| expires_at | 0% | null | name,tableInQuery |
| completed_at | 0% | null | tableInQuery |
| result | 0% | null | name,tableInQuery |

## code_upgrade_proposals (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name,tableInQuery |
| requested_by | 0% | null | name,tableInQuery |
| request | 0% | null | name,tableInQuery |
| proposal | 0% | null | tableInQuery |
| status | 0% | null | name,tableInQuery |
| created_at | 0% | null | name,tableInQuery |
| decided_by | 0% | null | tableInQuery |
| decided_at | 0% | null | tableInQuery |

## ai_provider_state (3 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| capability | 100% | "cloud_reviewer" | name,tableInQuery |
| paused | 100% | "0" | name,tableInQuery |
| health | 100% | "healthy" | name,tableInQuery |
| model_label | 100% | "gemma4-local" | tableInQuery |
| last_success_at | 33% | "2026-10-16T13:31:16.261Z" | name,tableInQuery |
| last_error_code | 100% | "" | tableInQuery |
| policy_version | 100% | "r1.0" | tableInQuery |
| updated_at | 100% | "2026-10-16T13:31:16.261Z" | name,tableInQuery |

## ai_policy_event (7 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "policy_1a0a52db-7eb3-4a40-a219-4d9082957cb3" | name,tableInQuery |
| capability | 100% | "cloud_reviewer" | name,tableInQuery |
| action | 100% | "pause" | name,tableInQuery |
| actor_id | 100% | "local-operator" | tableInQuery |
| detail | 100% | "{\"reason\":\"\"}" | name,tableInQuery |
| at | 100% | "2026-10-16T13:31:17.431Z" | name,tableInQuery |

## setup_bootstrap (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "1" | name,tableInQuery |
| lease_until | 100% | "1970-01-01T00:00:00.000Z" | tableInQuery |

## channel_registry (1 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "whatsapp-office-primary" | name,tableInQuery |
| provider_type | 100% | "whatsapp_web" | tableInQuery |
| status | 100% | "qr_ready" | name,tableInQuery |
| draft_only | 100% | "1" | tableInQuery |
| connection_payload_ref | 0% | null | tableInQuery |
| last_heartbeat_at | 100% | "2026-10-22T18:21:10.484Z" | name,tableInQuery |
| last_error | 0% | null | name,tableInQuery |
| created_at | 100% | "2026-10-16 19:08:59" | name,tableInQuery |
| updated_at | 100% | "2026-10-22T18:21:10.484Z" | name,tableInQuery |

## channel_contacts (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| company_id | 0% | null | name |
| channel_type | 0% | null | — |
| recipient_address | 0% | null | — |
| contact_role | 0% | null | — |
| consent_status | 0% | null | — |
| verification_status | 0% | null | — |
| created_at | 0% | null | name |
| updated_at | 0% | null | name |

## communication_drafts (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| channel_id | 0% | null | — |
| contact_id | 0% | null | — |
| company_id | 0% | null | name |
| case_id | 0% | null | — |
| task_id | 0% | null | name |
| message_body | 0% | null | — |
| status | 0% | null | name |
| approved_by | 0% | null | — |
| approved_at | 0% | null | — |
| created_at | 0% | null | name |
| updated_at | 0% | null | name |

## accounts (26 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| account_key | 100% | "205971997" | name,tableInQuery |
| username | 100% | "marwanhamada" | name,tableInQuery |
| label | 100% | "marwanhamada" | name,tableInQuery |
| secret_cipher | 100% | "G85qaCwDuDiJtRE=" | name,tableInQuery |
| secret_iv | 100% | "z3uzoXeSQ4OsGqV6" | name,tableInQuery |
| secret_tag | 100% | "nwF0h9uWFYa7xxUkQmZNbA==" | name,tableInQuery |
| enabled | 100% | "1" | name,tableInQuery |
| created_at | 100% | "2026-10-16T23:27:12.729Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-19T14:02:32.433Z" | name,tableInQuery |

## legal_deadlines (5 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "5" | name |
| match_key | 100% | "البطاقة الضريبية سارية" | — |
| doc_name | 100% | "بطاقة تعريف ضريبية" | — |
| legal_days | 100% | "15" | — |
| basis | 100% | "قانون الإجراءات الضريبية الموحد 206/2020 - المادة 21: إخطار " | — |
| anchor_mode | 100% | "law_window" | — |

## company_documents (187 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "doc_company_029139f708176ed5462d49e9_commercial_registry" | name,tableInQuery |
| company_id | 100% | "company_029139f708176ed5462d49e9" | name,tableInQuery |
| account_key | 100% | "marwanhamada" | name,tableInQuery |
| doc_type | 100% | "acceptance_notice" | name,tableInQuery |
| doc_name | 100% | "البطاقة الضريبية" | tableInQuery |
| doc_number | 100% | "" | name,tableInQuery |
| issuer | 100% | "مصلحة الضرائب المصرية" | tableInQuery |
| issue_date | 100% | "" | tableInQuery |
| expiry_date | 100% | "" | tableInQuery |
| assigned_role | 100% | "المحاسب القانوني للملف" | tableInQuery |
| status | 100% | "valid" | name,tableInQuery |
| notes | 100% | "تم استيراد تاريخ الصلاحية تلقائياً من بوابة مصلحة الضرائب ال" | tableInQuery |
| file_path | 100% | "" | tableInQuery |
| source | 100% | "portal_sync" | name,tableInQuery |
| created_at | 100% | "2026-10-17T19:03:34.415Z" | name,tableInQuery |
| updated_at | 100% | "2026-10-17T19:03:34.415Z" | name,tableInQuery |
| direction | 100% | "incoming" | tableInQuery |
| received_at | 100% | "" | name,tableInQuery |
| sent_at | 100% | "" | tableInQuery |
| registered_by | 100% | "system" | tableInQuery |
| custodian | 100% | "" | tableInQuery |
| last_resaved_at | 100% | "" | tableInQuery |
| last_resaved_by | 100% | "" | tableInQuery |
| ocr_state | 100% | "pending" | tableInQuery |
| ocr_text | 100% | "" | tableInQuery |
| ocr_updated_at | 100% | "" | tableInQuery |

## company_document_history (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| document_id | 0% | null | — |
| actor | 0% | null | — |
| action | 0% | null | name |
| occurred_at | 0% | null | name |
| details | 0% | null | name |

## company_inspection_profiles (16 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| company_id | 100% | "company_029139f708176ed5462d49e9" | name |
| inspection_officer | 100% | "ية الاسكندرية سموحة رجب زيك شارع ١٥ : املأمورية عنوان ١٦٣٩٥ " | — |
| books_from_year | 100% | "" | — |
| books_to_year | 100% | "" | — |
| inspection_notes | 100% | "تم رصد إشارة إلى الفحص أو الدفاتر من نص ملف PDF المحفوظ." | — |
| source_document_id | 100% | "pdf_d3e5a92c69c9c4f0" | — |
| updated_at | 100% | "2026-10-22T18:20:41.870Z" | name |

## scan_runs (0 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 0% | null | name |
| account_key | 0% | null | name |
| company_id | 0% | null | name |
| section | 0% | null | name |
| started_at | 0% | null | — |
| finished_at | 0% | null | — |
| ok | 0% | null | name |
| http_errors | 0% | null | — |
| items | 0% | null | name |
| content_hash | 0% | null | — |
| error | 0% | null | name |

## service_status (6 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| service | 100% | "assistant" | name,tableInQuery |
| pid | 100% | "25708" | name,tableInQuery |
| status | 100% | "online" | name,tableInQuery |
| last_heartbeat | 100% | "2026-10-22T18:21:10.846Z" | name,tableInQuery |
| meta_json | 100% | "{\"telegram\":false,\"email\":false,\"queue\":{\"backlog\":0,\"dead\":" | name,tableInQuery |

## service_locks (3 rows)

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| service | 100% | "harness" | name,tableInQuery |
| owner | 100% | "mailtg-sender:25708:2435831a" | name,tableInQuery |
| expires_at | 100% | "2026-10-22T18:21:39.833Z" | name,tableInQuery |

## notification_outbox (6 rows) — internal

| column | non-null % | sample | referenced in code |
|---|---|---|---|
| id | 100% | "1" | name,tableInQuery |
| event_id | 100% | "830263c6-4f27-49c1-b53a-3ae18411ec6c" | name,tableInQuery |
| channel | 100% | "whatsapp" | name,tableInQuery |
| recipient | 100% | "201126170117@c.us" | name,tableInQuery |
| payload_json | 100% | "{\"text\":\"تنبيه مدير المساعد: 180000221747- اخطار بعناصرربط ا" | name,tableInQuery |
| idempotency_key | 100% | "053122899de29c0b8e729782e963dc565f0489d29bacb78ac95f8e7fff15" | tableInQuery |
| status | 100% | "pending" | name,tableInQuery |
| attempts | 100% | "0" | name,tableInQuery |
| next_attempt_at | 100% | "2026-10-22T14:25:11.783Z" | tableInQuery |
| lease_owner | 0% | null | tableInQuery |
| lease_until | 0% | null | tableInQuery |
| last_error | 0% | null | name,tableInQuery |
| provider_msg_id | 0% | null | tableInQuery |
| created_at | 100% | "2026-10-22T14:25:11.783Z" | name,tableInQuery |
| sent_at | 0% | null | tableInQuery |
| shadow | 100% | "1" | name,tableInQuery |

## Empty-data flags (populated table, 0% columns)
- `companies.source_updated_at`: column exists, 0% populated in 26 rows
- `obligations.local_reviewed_at`: column exists, 0% populated in 800 rows
- `obligations.review_state`: column exists, 0% populated in 800 rows
- `payments.local_paid_at`: column exists, 0% populated in 942 rows
- `payments.review_state`: column exists, 0% populated in 942 rows
- `messages.received_at`: column exists, 0% populated in 520 rows
- `harness_status.next_cycle_at`: column exists, 0% populated in 1 rows
- `account_status.parked_until`: column exists, 0% populated in 26 rows
- `failures.resolved_at`: column exists, 0% populated in 11 rows
- `failures.company_id`: column exists, 0% populated in 11 rows
- `users.image`: column exists, 0% populated in 1 rows
- `user_accounts.accessToken`: column exists, 0% populated in 1 rows
- `user_accounts.refreshToken`: column exists, 0% populated in 1 rows
- `user_accounts.idToken`: column exists, 0% populated in 1 rows
- `user_accounts.accessTokenExpiresAt`: column exists, 0% populated in 1 rows
- `user_accounts.refreshTokenExpiresAt`: column exists, 0% populated in 1 rows
- `user_accounts.scope`: column exists, 0% populated in 1 rows
- `reminders.sent_at`: column exists, 0% populated in 3 rows
- `reminders.cancelled_at`: column exists, 0% populated in 3 rows
- `reminders.company_id`: column exists, 0% populated in 3 rows
- `channel_registry.connection_payload_ref`: column exists, 0% populated in 1 rows
- `channel_registry.last_error`: column exists, 0% populated in 1 rows