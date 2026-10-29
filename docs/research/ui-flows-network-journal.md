# Журнал UI-флоу Allure TestOps: путь → тулы → сетевой лог

> Цель: зафиксировать, какие запросы и в каком порядке шлёт **реальный UI** Allure TestOps для каждого пользовательского пути. Журнал потом накладывается на описания MCP-тулов (`src/tools/*.ts`), и они правятся под фактическую последовательность.

| | |
|---|---|
| Дата | 2026-10-29 |
| Стенды | `sandbox.testops.cloud` (проект 35, гость, только read), `klumba.testops.cloud` (ROLE_ADMIN, проект `[MCP-RESEARCH] UI flows`, id=1) |
| Метод | Claude in Chrome, перехват `XMLHttpRequest.prototype` в странице (UI ходит через XHR). Для контрольных проверок прямые `fetch` с `X-XSRF-TOKEN` из cookie, по тем же правилам, по которым ходит MCP-сервер |
| Маскирование | токены, cookies и заголовки авторизации не записываются |

**Легенда статусов**
- ✅ OK: тул шлёт то же, что UI, или эквивалент.
- ⚠️ ORDER: эндпоинт тот же, но нужен другой порядок или дополнительный шаг.
- ❌ MISMATCH: тул шлёт иначе, чем UI, и это приводит к потере или искажению данных.
- 🕳 GAP: UI использует эндпоинт, для которого нет тула.
- 👻 LEGACY: тул ходит в эндпоинт, которым UI не пользуется и который отдаёт неполные данные.

---

## Сводная таблица

| # | Пользовательский путь | UI-вызовы (порядок) | MCP-тулы | Статус |
|---|---|---|---|---|
| P0 | Создать проект | `POST /api/project {name, abbr}` | — | 🕳 (вне скоупа) |
| A1 | Список и поиск ТК | `GET /api/v2/project/{pid}/test-case/flat?search=…`, `GET /api/testcasetree/countleaves`, `POST /api/v2/test-case/bulk/count` | `search_test_cases`, `find_test_cases` (`/api/testcase/__search?rql=`) | ⚠️ другой эндпоинт, но AQL-поиск рабочий |
| A2 | Создать ТК | `POST /api/v2/project/{pid}/test-case/flat {name}` → карточка | `create_test_case` (`POST /api/testcase`) | ⚠️ см. A2 |
| A2.1 | Открыть карточку ТК | `overview`, `step`, `cfv`, `history`, `relation`, `comment`, `defect`, `mute`, `scenariofromrun` | `get_test_case_overview`, `get_test_case_steps`, … | ✅ |
| A3.1 | Добавить шаг | `POST /api/testcase/step?afterId={prev}&withExpectedResult=false {testCaseId, bodyJson}` | `create_test_case_step` | ⚠️ нет `afterId` |
| A3.2 | Шаг + ER одним действием | `POST /api/testcase/step?afterId=…&withExpectedResult=true {testCaseId, bodyJson, expectedResultId:-1}` → `POST step {parentId: wrapperId, body}` на каждую строку ER | `create_test_case_step(expectedResult)` | ❌ текст ER теряется |
| A3.3 | Добавить ER к существующему шагу | `PATCH /api/testcase/step/{id}?withExpectedResult=true {bodyJson, expectedResultId:-1}` → `POST step {parentId: wrapperId, body}` | `set_test_case_step_expected_result` | ✅/⚠️ (`body` обязателен) |
| A3.4 | Изменить текст шага | `PATCH /api/testcase/step/{id}?withExpectedResult={hasER} {bodyJson, expectedResultId: <текущий>}` | `update_test_case_step(body)` | ❌ **удаляет ER** |
| A3.5 | Вложенный шаг | `POST /api/testcase/step {testCaseId, parentId, bodyJson}` | `create_test_case_step(parentId)` | ✅ |
| A3.6 | Дублировать шаг | `POST /api/testcase/step/{id}/copy {afterId}` | — | 🕳 |
| A3.7 | Удалить шаг | `DELETE /api/testcase/step/{id}` (каскадно с ER и детьми) | — | 🕳 |
| A3.8 | Переместить шаг | `POST /api/testcase/step/{id}/move {parentId}` \| `{afterId}` \| `{beforeId}` | — | 🕳 |
| A3.9 | Прочитать сценарий | `GET /api/testcase/{id}/step` | `get_test_case_steps` ✅, `get_test_case_scenario` 👻 | 👻 `/scenario` всегда `{"steps":[]}` |
| A3.10 | Снять ER (Convert to Step) | `PATCH step/{id}?withExpectedResult=false {bodyJson}` | (так сейчас работает `update_test_case_step(body)`) | ❌ |
| A3.11 | Вложение в шаге | `POST /api/testcase/attachment?testCaseId` → `POST step {attachmentId, testCaseId}` | `upload_test_case_attachment` + — | 🕳 |
| A4 | Description / precondition / статус / слой / имя | `PATCH /api/testcase/{id} {description\|precondition\|statusId\|testLayerId\|name}` | `update_test_case` | ✅ (🕳 справочники) |
| A5 | Теги | `POST /api/tag {name}` → `POST /api/testcase/{id}/tag [{id}]` | `set_test_case_tags` | ⚠️ full replace не описан |
| A5 | Issue links | `GET /api/integration/suggest?operation=issue_suggest` → … | `set_test_case_issues` | 🕳 нужен integrationId |
| A6 | Custom fields | `GET /api/project/{pid}/cfv?customFieldId` → `POST /api/project/{pid}/cfv` → `POST /api/testcase/{id}/cfv` (replace) | `set_test_case_custom_fields` (bulk append) | ✅ / 🕳 список полей |
| A8 | В корзину / восстановить | `DELETE /api/testcase/{id}?force=false` / `POST /api/v2/test-case/bulk/restore {selection.deleted:true}` | `delete_test_case` ✅, `restore_test_case` ✅, `restore_test_cases_bulk` ❌ | ❌ |
| B | Shared steps | `POST /api/sharedstep` → `POST /api/sharedstep/step` → `POST /api/testcase/step {sharedStepId}` | `create_shared_step` ✅, шаги — нет | 🕳 P0 |
| C | Ручной прогон | `POST /api/testcase/bulk/run` → `assign` → `resolve?v2=true {execution}` → `close` | `create_launch`+`add_test_cases_to_launch` ✅, `resolve_test_result` ❌ | ❌ |
| C7 | Rerun | `POST /api/testresult/{id}/rerun {username}` | — | 🕳 |
| D | Тест-план | `POST /api/testplan {baseRql, treeSelection}` → `POST /run {launchName}` | `create_test_plan` ⚠️, `run_test_plan` ✅ | ⚠️ |
| E | Дефекты | `POST /api/defect {matcher}` → `POST /api/testresult/{tr}/defect/{d}` → `POST /api/defect/bulk/close {selection}` | `create_defect` ✅, `link_defect_to_test_results` ❌, `bulk_close/reopen_defects` ❌ | ❌ |
| F | Релизы (только API) | `POST /api/release` → `POST /release/{id}/launch/{lid}` | release-тулы | ✅ |

| **Часть 2** | | | | |
| A9 | Комментарии ТК | `POST /api/comment {testCaseId, body}`, `DELETE /api/comment/{id}` | — | 🕳 |
| A5+ | Members / Relations / Test keys | `POST /api/testcase/{id}/members`, `POST /api/testcase/{id}/relation`; test keys требуют интеграцию | — | 🕳 |
| A11–A15 | Links / Parameters / Clone / Versions / Change log | `PATCH {links}`, `POST …/example/nwise` → `POST …/{id}/example`, `POST …/{id}/clone`, `POST …/{id}/version`, `GET /api/testcase/audit` | `update_test_case` (links) ✅, остальное — | 🕳 (clone — P0) |
| A16 | Bulk-действия списка | `/api/v2/test-case/bulk/{status/set, layer/set, member/add, mute/add, test-plan/create, clone, remove, cfv/remove}` | tags/cfv add/links ✅ | 🕳 |
| A18 | Деревья и папки | `PUT …/test-case/tree/group?treeId`, `POST …/test-case/tree/leaf?treeId&nodeId` | — | 🕳 |
| A20 | Секции и ER уровня кейса | `POST /api/projectproperty`, `PATCH /api/testcase/{id} {expectedResult}` | `update_test_case` | ⚠️ два разных ER |
| C9–C16 | Launch: edit / copy / merge / reopen / delete / env; результат: mute/unmute | `PATCH /api/launch/{id}`, `POST …/copy`, `POST /api/launch/merge`, `POST …/reopen`, `DELETE`, `POST /api/evv`, `POST /api/testresult/{id}/mute\|unmute` | update/reopen/delete ✅ | 🕳 copy/merge/mute |
| D4–D7 | Тест-план: diff / sync / edit / delete | `GET …/diff`, `POST …/sync`, `PATCH`, `DELETE` | update/delete ✅ | 🕳 sync (P0) |
| E6–E12 | Дефект: матчеры / rename / close / delete | `POST /api/defect/matcher`, `DELETE /api/defect/matcher/{id}`, `PATCH {name\|closed}`, `DELETE /api/defect/{id}` | `update_defect` ✅ | 🕳 |
| G2 | Дашборд / виджет / AQL-валидация | `POST /api/dashboard {templateId}`, `POST /api/widget`, `GET /api/testcase/query/validate` | dashboards ✅ | 🕳 widget, validate (P0) |
| R | Перепроверка read/write тулов | 60/64 read OK | `find_similar_failures` ❌, `update_test_result` ❌ | см. часть 2 |
| **Часть 3** | | | | |
| A9+/A18+/A21 | Правка комментария, drag ТК между папками, rename папки, Move to project | `PATCH /api/comment/{id}`, `POST /api/v2/test-case/tree/bulk/drag-and-drop`, `PUT …/tree/group/{id}/name`, `POST /api/v2/test-case/bulk/move` | — | 🕳 |
| A22/C17 | Export ТК / launch | `POST …/bulk/export/csv` · `POST /api/export/testresult/csv` → `GET /api/export/{id}` → `GET /api/export/download/{id}` | — | 🕳 |
| C18–C20 | Import результатов, Add from test cases / files | `POST /api/launch/upload`, `POST /api/launch/{id}/upload`, `POST /api/launch/{id}/testcase/add` | `add_test_cases_to_launch` ✅ | 🕳 upload |
| **Часть 5** | Сверка с OpenAPI 26.3.1.2 (`sw.json`) | 126 эндпоинтов MCP и 189 эндпоинтов журнала: все есть в схеме; deprecated — `/testcase/{id}/scenario`, `/api/cf`; `POST /testcase/{id}/cfv` недокументирован | все 114 тулов сверены | поправки P1–P9, новые N1–N10 |
| R+ | Issue-тулы без интеграции | `POST /api/testcase/{id}/issue`, `POST /api/defect/{id}/issue` | `set_test_case_issues` ❌ (200 + no-op) | ⛔ интеграцию не разрешено создавать |

Полный список правок — в разделах [«Итог: кандидаты на правку»](#итог-кандидаты-на-правку-вход-для-следующего-этапа) и [«Дополнения к итоговому списку правок»](#дополнения-к-итоговому-списку-правок).

---

## P0. Создание проекта

**Путь:** Home → `+ Project` → Name → `Create`.

| # | UI-действие | Запрос | Request | Статус | Response (ключевое) |
|---|---|---|---|---|---|
| 1 | Открытие Home | `GET /api/project?favorite=true&size=1&v2=true`, `?my=true…`, `?size=1…` | — | 200 | счётчики вкладок |
| 2 | Create | `POST /api/project` | `{"name":"[MCP-RESEARCH] UI flows","abbr":"[M"}` | 200 | `{id:1, isPublic:false, abbr}` |
| 3 | Редирект в проект | `GET /api/project/1`, `/api/filter?projectId=1&type=TEST_CASE`, `/api/testcaseupdateschema`, `/api/cf?projectId=1&v2=true`, `/api/tree`, `countleaves`, `test-case/flat` | — | 200 | бутстрап страницы тест-кейсов |

**Наблюдения:** `abbr` UI генерирует сам из первых символов имени. Тула нет, для MCP это вне скоупа.

---

## A1. Список и поиск тест-кейсов

**Путь:** Test cases → строка «Search or filters» → текст → Enter.

| # | UI-действие | Запрос | Статус | Назначение |
|---|---|---|---|---|
| 1 | Загрузка страницы | `GET /api/filter?projectId&size=2000&type=TEST_CASE` | 200 | сохранённые фильтры |
| 2 | | `GET /api/testcaseupdateschema?projectId` | 200 | схема массового обновления |
| 3 | | `GET /api/cf?projectId&size=2000&v2=true` | 200 | **список custom fields проекта** (`id`, `name`, `required`, `singleSelect`). ⚠️ В схеме 26.3.1.2 этот эндпоинт `deprecated`; недепрекейтнутая замена — `GET /api/project/{projectId}/cf` |
| 4 | | `GET /api/tree?projectId&size=2000` | 200 | деревья (группировки) |
| 5 | | `GET /api/testcasetree/countleaves?projectId&sort=name,asc&deleted=false` | 200 | количество |
| 6 | | `POST /api/v2/test-case/bulk/count` | 200 | счётчик выделения |
| 7 | | `GET /api/v2/project/{pid}/test-case/flat?page=0&size=100&deleted=false&sort=name,asc` | 200 | **плоский список**: `{id, name, automated, external, layerName, status{id,name,color}, workflow{id,name}}` |
| 8 | Поиск «launch» | те же 5–7 с параметром `search=<text>` | 200 | полнотекстовый фильтр |

**Наблюдения**
- UI-поиск идёт не через `/api/testcase/__search?rql=`, а через `flat?search=`. `search_test_cases` и `find_test_cases` (AQL через `__search`) остаются валидными: это тот же движок, к которому обращается расширенный фильтр.
- `GET /api/cf?projectId=&v2=true` — это список custom fields проекта. В `src/api/test-cases.ts:256` есть `listProjectCustomFields` (`/api/project/{id}/cf`), но тулом он не выставлен: 🕳 GAP для резолва `customField.id`.
- Системные custom fields имеют **отрицательные id**: `Suite=-5`, `Story=-3`, `Feature=-2`, `Epic=-1` (сандбокс, проект 35).

---

## A2. Создание тест-кейса

**Путь:** Test cases → `+ Test Case` (внизу списка) → ввод имени → Enter.

| # | UI-действие | Запрос | Request | Статус | Response |
|---|---|---|---|---|---|
| 1 | Enter | `POST /api/v2/project/1/test-case/flat` | `{"name":"[MCP-RESEARCH] TC1 login flow"}` | 200 | `{id:1, name, automated:false, status:{id:-1,name:"Draft"}, workflow:{id:-1,name:"Default Manual"}}` |
| 2 | Авто-открытие карточки | `GET /api/testcasetree/countleaves`, `GET /api/status?workflowId=-1&size=2000` | | 200 | статусы workflow для селектора |
| 3 | | `GET /api/testcase/1/overview` | | 200 | `{name, description, precondition?, status, workflow, layer, tags, links, issues, members, customFields, parameters, examples, hasManualScenario, editable…}` |
| 4 | | `GET /api/testcase/1/step` | | 200 | дерево шагов (см. A3.9) |
| 5 | | `GET /api/testcase/1/cfv?projectId=1&v2=true` | | 200 | значения custom fields |
| 6 | | `GET /api/testcase/1/scenariofromrun?v2=true`, `/relation`, `/history?size=5`, `/defect?status=opened`, `/api/mute?testCaseId`, `/api/comment?testCaseId`, `/api/projectproperty?projectId` | | 200 | вспомогательные панели |

**Наблюдения**
- UI создаёт кейс **только по имени**. Шаги, ER, теги и поля добавляются отдельными запросами уже после создания: тот же порядок, что описан в `create_test_case` ("steps are NOT created via this tool").
- `create_test_case` ходит в `POST /api/testcase` (legacy, принимает полный DTO). Это допустимо, но UI-эталон — `POST /api/v2/project/{pid}/test-case/flat {name}`.
- Статус по умолчанию `Draft (id -1)`, workflow `Default Manual (id -1)`.

---

## A3. Сценарий: шаги и expected result

### Модель данных (`GET /api/testcase/{id}/step`)

```jsonc
{
  "root": { "children": [1, 2, 5] },          // порядок шагов верхнего уровня
  "scenarioSteps": {                          // плоская карта id → узел
    "1": { "id":1, "body":"Open login page", "bodyJson":{…}, "expectedResultId": 14 },
    "14": { "id":14, "body":"Expected Result", "children":[15] },   // контейнер ER
    "15": { "id":15, "body":"Login form is displayed" },            // строка ER
    "2": { "id":2, "body":"Enter valid credentials", "children":[9] }, // вложенные шаги
    "366": { "id":366, "sharedStepId":34 }                          // ссылка на shared step
  },
  "sharedSteps": { "34": { "body":"…", "children":[35,36] } },
  "sharedStepScenarioSteps": { … }, "attachments": { … }, "sharedStepAttachments": { … }
}
```

- ER — это **контейнер-узел** `"Expected Result"`, на который ссылается `step.expectedResultId`. Строки ER — `children` контейнера.
- Вложенные шаги — это `children` самого шага.
- UI шлёт `bodyJson` (ProseMirror doc), но API принимает и plain `body` (проверено).

### A3.1 Добавить шаг (Enter в поле «Describe the action»)

| # | Запрос | Request | Response |
|---|---|---|---|
| 1 | `POST /api/testcase/step?withExpectedResult=false` | `{"bodyJson":{doc "Open login page"},"testCaseId":1}` | `{"createdStepId":1,"scenario":{root, scenarioSteps…}}` |
| 2 | `POST /api/testcase/step?afterId=1&withExpectedResult=false` | `{"bodyJson":{doc "Enter valid credentials"},"testCaseId":1}` | `{"createdStepId":2,…}` |

UI всегда передаёт `afterId` (позицию). `create_test_case_step` его не поддерживает, поэтому шаг всегда добавляется в конец. Для генерации сценария подряд это нормально, для вставки в середину нужен `afterId` (⚠️).

### A3.2 Новый «Step with expected result» (меню шага → Add new → Step with expected result, Alt+Enter)

| # | Запрос | Request | Response |
|---|---|---|---|
| 1 | `POST /api/testcase/step?afterId=2&withExpectedResult=true` | `{"bodyJson":{doc "Click Sign in"},"expectedResultId":-1,"testCaseId":1}` | `createdStepId:5`, у шага 5 `expectedResultId:6` (пустой контейнер) |
| 2 | ввод 1-й строки ER: `POST /api/testcase/step?withExpectedResult=false` | `{"bodyJson":{doc "User is redirected to dashboard"},"parentId":6,"testCaseId":1}` | `createdStepId:7` |
| 3 | ввод 2-й строки ER: `POST /api/testcase/step?afterId=7&withExpectedResult=false` | `{"bodyJson":{doc "Welcome toast shown"},"parentId":6,"testCaseId":1}` | `createdStepId:8` |

**Контрольная проверка MCP (`create_test_case_step` с `expectedResult`)**: `POST /api/testcase/step?withExpectedResult=true {"testCaseId":1,"body":"Open profile","expectedResult":"Profile visible; Avatar shown"}` → 200, создан шаг и **пустой** контейнер `ER#20 "Expected Result"` без детей. **Текст ER молча теряется** (❌). Строковое поле `expectedResult` сервер игнорирует. Правильно: после создания шага сделать по одному `POST step {parentId: expectedResultId, body: line}` на каждую строку.

### A3.3 Превратить шаг в шаг с ER (меню шага → Convert to → Step with expected result, Ctrl+E)

| # | Запрос | Request | Response |
|---|---|---|---|
| 1 | `PATCH /api/testcase/step/1?withExpectedResult=true` | `{"bodyJson":{doc "Open login page"},"expectedResultId":-1}` | шаг 1 получил `expectedResultId:3` (контейнер) |
| 2 | `GET /api/testcase/1/step` (рефреш) | | |
| 3 | ввод ER: `POST /api/testcase/step?withExpectedResult=false` | `{"bodyJson":{doc "Login form is displayed"},"parentId":3,"testCaseId":1}` | `createdStepId:4` |

**Контрольная проверка MCP (`set_test_case_step_expected_result`)**
- `PATCH step/{id}?withExpectedResult=true {"expectedResult":" "}` **без `body`** → `400 {"message":"step.onlyonedetail"}`: тул падает, если не передать `body` (⚠️, в описании это упомянуто как "may cause").
- С `body` → 200, контейнер создан (`wrapper=17`), затем `POST step {parentId:17, body}` → строка ER на месте ✅.
- Если контейнер уже есть и передан `{body, expectedResult:" "}` → контейнер сохраняется, следующий `POST` **добавляет** строку (append), а не заменяет её.

### A3.4 Редактирование текста шага (клик в текст → правка → blur)

| # | Запрос | Request |
|---|---|---|
| 1 | `PATCH /api/testcase/step/1?withExpectedResult=true` | `{"bodyJson":{doc "Open login page (https)"},"expectedResultId":3}` |

UI **всегда передаёт текущий `expectedResultId`** и `withExpectedResult=true`, если у шага есть ER.

> **Поправка (часть 5):** поля `expectedResultId` нет ни в `ScenarioStepPatchDto`, ни в `ScenarioStepCreateDto` схемы 26.3.1.2. UI шлёт его недокументированно (`-1` = «создать контейнер», `<id>` = «сохранить существующий»), и сервер его учитывает (T3). В схеме вместо него есть строковое `expectedResult` (только в PATCH), но текст ER оно не задаёт. Для create в схеме есть позиционирование через query `beforeId`/`afterId`.

**Контрольная проверка (критично)**

| Тест | Запрос | Результат |
|---|---|---|
| T1 (как шлёт `update_test_case_step({stepId, body})`) | `PATCH /api/testcase/step/1 {"body":"…"}` (без query) | 200, **ER шага удалён целиком** ❌ |
| T1b (повтор на шаге 16) | `PATCH /api/testcase/step/16 {"body":"Logout (edited)"}` | 200, **ER#17 удалён** ❌ |
| T2 | `PATCH …/step/1?withExpectedResult=true {"body":"…"}` (без `expectedResultId`) | 200, старый ER заменён **новым пустым** контейнером `ER#14` ❌ |
| T3 (как UI) | `PATCH …/step/1?withExpectedResult=true {"body":"…","expectedResultId":14}` | 200, ER сохранён ✅ |

**Вывод:** описание `update_test_case_step` ("Omit expectedResult — existing expected results stay untouched") **не соответствует поведению API**. Чтобы изменить текст шага без потери ER, нужно: `get_test_case_steps` → взять `expectedResultId` → `PATCH ?withExpectedResult=true {body, expectedResultId}`. Это нужно исправлять в коде (`src/api/test-cases.ts:206` `updateTestCaseStep`), а не только в описании.

### A3.5 Вложенный шаг (Enter после шага → Tab → текст → Enter)

`POST /api/testcase/step?withExpectedResult=false {"bodyJson":{doc "Type username"},"parentId":2,"testCaseId":1}` → `createdStepId:9`, шаг 2 получил `children:[9]`. ✅ совпадает с `create_test_case_step(parentId)`.

### A3.6 Дублировать (меню → Duplicate, Ctrl+D)

`POST /api/testcase/step/5/copy {"afterId":5}` → копия с ER и всеми детьми, новый id 10. 🕳 GAP.

### A3.7 Удалить (меню → Delete, Shift+Backspace → диалог «Delete step with expected result» → Delete)

`DELETE /api/testcase/step/10` → 200, ответ: обновлённый сценарий (`root.children:[1,2,5]`). ER и дочерние шаги удаляются каскадно. 🕳 GAP (в описании `update_test_case` прямо сказано "steps cannot be deleted programmatically", но API это умеет).

### A3.8 Перемещение (drag за ручку `⋮⋮` слева от номера)

| Вариант | Запрос | Результат |
|---|---|---|
| UI: бросить шаг внутрь другого | `POST /api/testcase/step/5/move {"parentId":2}` | шаг 5 стал дочерним у шага 2 |
| API: `{afterId:1}` | `POST …/step/5/move {"afterId":1}` | `root=[1,5,2]` |
| API: `{beforeId:1}` | `POST …/step/5/move {"beforeId":1}` | `root=[5,1,2]` |
| API: `{afterId:2}` | `POST …/step/5/move {"afterId":2}` | `root=[1,2,5]` |

🕳 GAP.

### A3.9 Чтение сценария

- UI: `GET /api/testcase/{id}/step` (+ `scenariofromrun?v2=true` для шагов из прогона).
- `GET /api/testcase/{id}/scenario` **всегда возвращает `{"steps":[]}`** для кейсов с шагами в новой модели (проверено на sandbox #42 и klumba #1). `get_test_case_scenario` 👻 бесполезен и вводит агента в заблуждение («у кейса нет шагов»).

### A3.10 Снять ER (меню → Convert to → Step)

`PATCH /api/testcase/step/19?withExpectedResult=false {"bodyJson":{doc "Open profile"}}` → ER-контейнер удалён. Это объясняет T1: **`withExpectedResult=false` — команда «сделать шагом без ER»**, а не «не трогать ER».

### A3.11 Вложение в шаге (меню → Add attachment → Text / Table / Files)

| # | Запрос | Request | Response |
|---|---|---|---|
| 1 | `POST /api/testcase/attachment?testCaseId=1` (multipart) | `[FormData: file]` (name «New text», `text/plain`) | `[{"id":1,"entity":"test_case","name":"New text","contentType":"text/plain","contentLength":22}]` |
| 2 | `POST /api/testcase/step?afterId=19&withExpectedResult=false` | `{"attachmentId":1,"testCaseId":1}` | `createdStepId:21`; в `scenario.attachments` появился `1` |
| 3 | `GET /api/testcase/attachment/1/content` | | превью |

Вложение — это **отдельный узел сценария** `{attachmentId}`, вставляемый после шага (`afterId`), а не поле шага. `upload_test_case_attachment` покрывает только шаг 1. `create_test_case_step` не пробрасывает `attachmentId`: handler собирает payload только из `body/expectedResult/parentId/sharedStepId` (`src/tools/test-cases.ts:430`). 🕳 GAP.

### Меню шага (для справки)

`Delete (Shift+⌫)`, `Duplicate (Ctrl+D)` · Add new: `Step (Enter)`, `Step with expected result (Alt+Enter)`, `Shared step` · Add attachment: `Files`, `Table`, `Text` · Convert to: `Step with expected result (Ctrl+E)` / `Step`.

---

## A4. Поля тест-кейса

| Путь в UI | Запрос | Request | Тул | Статус |
|---|---|---|---|---|
| Description → ✎ → Save | `PATCH /api/testcase/1` | `{"id":1,"description":"Verifies **login** with valid credentials"}` → в ответе ещё и `descriptionHtml` | `update_test_case` | ✅ |
| Precondition (в UI секция скрыта, пока пустая) | `PATCH /api/testcase/1` | `{"precondition":"User exists"}` → `precondition`, `preconditionHtml` | `update_test_case` / `create_test_case` | ✅ (проверено API) |
| Бейдж статуса → Active | `PATCH /api/testcase/1` | `{"statusId":-3}` | `update_test_case` | ✅, но 🕳 нет тула для списка статусов |
| ⋯ → Change test layer → UI Tests → Submit | `GET /api/testlayer/suggest?size=20` → `PATCH /api/testcase/1` | `{"testLayerId":-2}` | `update_test_case` | ✅, но 🕳 нет тула для списка слоёв |
| ⋯ → Rename | `PATCH /api/testcase/{id} {name}` | | `update_test_case` | ✅ |

**Справочники (klumba, дефолт):**
- `GET /api/status?workflowId=-1` → `-4 Outdated, -3 Active, -2 Review, -1 Draft`.
- `GET /api/workflow` → `-2 Default Automated, -1 Default Manual`.
- `GET /api/testlayer` → `-3 API Tests, -2 UI Tests, -1 Unit Tests`.

UI всегда шлёт **частичный PATCH** только с изменённым полем. Поле статуса называется `statusId`, слоя — `testLayerId` (не `status:{id}` / `layer:{id}`).

Меню «⋯» карточки: Run, Rename, Edit parameters, Manage links, Change status, Change test layer, Version history, Clone, Generate code, Convert into manual, Move to trash.

---

## A5. Теги, issues, members

### Теги (Tags ✎ → ввод → Enter «create option» → Submit)

| # | Запрос | Request | Response |
|---|---|---|---|
| 1 | `GET /api/tag/suggest?projectId=1&size=20[&query=smoke]` | | существующие теги |
| 2 | `POST /api/tag` (только для нового тега) | `{"name":"smoke"}` | `{"id":1,"name":"smoke"}` |
| 3 | `POST /api/testcase/1/tag` | `[{"id":1}]` | `[{"id":1,"name":"smoke"}]` |

**Контрольная проверка `set_test_case_tags`:**
- `POST /api/testcase/1/tag [{"id":1},{"name":"auth"}]` → 200, тег `auth` **создан по имени** (id=2), предварительный `POST /api/tag` не нужен.
- `POST /api/testcase/1/tag [{"name":"smoke"}]` → 200, итог `[smoke]`: `auth` снят. **Полная замена**, а не добавление.
- Описание тула («Set tags for a test case.») не говорит ни о полной замене, ни о формате `[{id}|{name}]` (⚠️). Для добавления без потери тегов есть `add_test_case_tags_bulk`.

### Issue links (Issues links ✎ → Add)

`GET /api/integration/suggest?query=&operation=issue_suggest&projectId=1&page=0` → пусто (на стенде нет интеграций с трекером). Строка в диалоге — пара «Issue tracker (integration) + Key». Значит, `set_test_case_issues` требует `integrationId`, а тула для списка интеграций нет (🕳). Без интеграции привязать issue нельзя.

### Members

Не снято (вкладка зависала на дропдаунах при перехвате). Owner по умолчанию — создатель кейса.

---

## A6. Custom fields

**Путь:** Custom Fields ✎ → диалог со всеми полями проекта → выбрать или создать значение → Submit.

| # | UI-действие | Запрос | Request | Response |
|---|---|---|---|---|
| 1 | Открытие дропдауна Feature | `GET /api/project/1/cfv?customFieldId=-2&size=10` | | значения поля в проекте |
| 2 | Ввод текста | `GET /api/project/1/cfv?customFieldId=-2&size=10&query=Authentication` | | поиск |
| 3 | Enter «create option» | `POST /api/project/1/cfv` | `{"customField":{"id":-2},"name":"Authentication"}` | `{"id":1,"name":"Authentication","global":false,"customField":{"id":-2,"name":"Feature",…}}` |
| 4 | Submit | `POST /api/testcase/1/cfv?id=1` | `[{"customField":{"id":-2},"id":1,"name":""}]` | все поля кейса с выбранными значениями. ⚠️ **POST в схеме 26.3.1.2 отсутствует** (недокументирован); документирован `PATCH /api/testcase/{id}/cfv` с `[CustomFieldWithValuesDto{customField, values[]}]`, но он отвечает **500** на любые тела (часть 5). Рабочий путь — недокументированный POST (как UI) или bulk `cfv/add` + `cfv/remove` |

**Список полей проекта:** UI берёт его из `GET /api/cf?projectId=1&size=2000&v2=true` при загрузке страницы. В `src/api/test-cases.ts:251` уже есть `listProjectCustomFields` (`GET /api/project/{id}/cf`, 200 OK), но тулом он не выставлен (🕳). Агенту приходится угадывать id через `get_test_case_custom_fields` на чужом кейсе.

**Системные поля (id < 0):** `-5 Suite, -4 Component, -3 Story, -2 Feature, -1 Epic`.

**Контрольные проверки:**

| Тест | Запрос | Результат |
|---|---|---|
| UI-эндпоинт, значение по имени | `POST /api/testcase/1/cfv [{"customField":{"id":-3},"name":"Happy path"}]` | 200, значение **создано** (id=2), Feature **очищен** → **полная замена всех CF кейса** |
| MCP `set_test_case_custom_fields`, новое имя | `POST /api/v2/test-case/bulk/cfv/add {selection, cfv:[{customField:{id:-2},name:"Login"}]}` | 200, значение создано (id=3) и **добавлено** |
| MCP, по id | `… cfv:[{customField:{id:-2},id:1}]` | 200, Feature = `Authentication / Login` (append) |
| MCP, существующее имя | `… cfv:[{customField:{id:-2},name:"Authentication"}]` | 200, без дубликата |

**Выводы:**
- `set_test_case_custom_fields` работает в режиме **append**, значения **по имени** работают (создают или переиспользуют). Оговорку в описании "values MAY accept name… not guaranteed" можно смягчить.
- Снять значение через MCP нельзя: нужен `POST /api/testcase/{id}/cfv` (full replace) или bulk-remove (🕳).
- Тело bulk-запроса: ключ `cfv`, а не `customFieldValues` (иначе `409 cfv must not be null`). Тул шлёт правильно ✅.

---

## A8. Удаление и восстановление тест-кейса

| # | UI-действие | Запрос | Request | Статус |
|---|---|---|---|---|
| 1 | ⋯ → Move to trash | `DELETE /api/testcase/2?force=false` | | **202** (soft delete, `deleted:true`) |
| 2 | All test cases ▾ → Trash | `GET /api/v2/project/1/test-case/flat?treeId=0&deleted=true…`, `countleaves …deleted=true` | | 200 |
| 3 | Строка ⋯ → Restore | `POST /api/v2/test-case/bulk/count` | `{"selection":{"projectId":1,"testCasesInclude":[2],"inverted":false,"deleted":true,…}}` | `{"total":1}` |
| 4 | «Yes, restore» | `POST /api/v2/test-case/bulk/restore` | тот же `selection` с `"deleted":true` | 204 |

Меню строки в корзине: Select, Restore, Delete permanently.

**Контрольные проверки:**

| Тул | Запрос | Результат |
|---|---|---|
| `delete_test_case` | `DELETE /api/testcase/2` (без `force`) | 202, soft delete ✅ |
| `restore_test_case` | `POST /api/testcase/2/restore` | 200, `deleted:false` ✅ |
| `restore_test_cases_bulk` (⚠️ тело составлено вручную, **не** как в коде MCP — см. часть 6) | `POST /api/testcase/bulk/restore {selection:{projectId,testCasesInclude:[2],inverted:false}}` | **400 `test-case-bulk.can-not-restore-not-deleted-test-case`** ❌ |
| то же + `deleted:true` | `POST /api/testcase/bulk/restore {selection:{…,"deleted":true}}` | 204, но кейс **остался удалённым** ❌ (тихий no-op) |
| UI-эндпоинт | `POST /api/v2/test-case/bulk/restore {selection:{…,"deleted":true}}` | 204, `deleted:false` ✅ |

**Вывод:** `restore_test_cases_bulk` нужно перевести на `/api/v2/test-case/bulk/restore` и добавить `selection.deleted=true`. Для одиночного восстановления надёжен `restore_test_case`.

> **Поправка (часть 5):** причина no-op v1 — **неверное имя поля**. В схеме v1 `POST /api/testcase/bulk/restore` принимает `TestCaseBulkDto{selection: TestCaseTreeSelectionDto}`, где кейсы задаются через `leafsInclude`; поля `testCasesInclude` там нет (оно из v2 `TestCaseSelectionDtoV2`), поэтому выборка пустая. Проверено: v1 с `{leafsInclude:[13], deleted:true}` → 204, кейс восстановлен; без `deleted:true` → 400. Варианты исправления: v1 + `leafsInclude` + `deleted:true` **или** v2 + `testCasesInclude` + `deleted:true`.

---

## B. Shared steps

| # | UI-действие | Запрос | Request | Response / статус |
|---|---|---|---|---|
| B1 | Открыть Shared steps | `GET /api/sharedstep?projectId=1&sort=lastModifiedDate,desc&search=&archived=false&page=0&size=15` (+ счётчики `archived=true/false&size=1`) | | список |
| B2 | `+ Shared step` → Name → Create | `POST /api/sharedstep` | `{"name":"[MCP-RESEARCH] SS Login as admin","projectId":1}` | `{id:1, archived:false}` |
| B2 | авто-открытие | `GET /api/sharedstep/1`, `/step`, `/usage?size=1`, `/api/sharedstep/attachment?sharedStepId=1&projectId=1` | | |
| B3 | Шаг (Enter) | `POST /api/sharedstep/step?withExpectedResult=false` | `{"bodyJson":{doc "Open /login"},"sharedStepId":1}` | `{createdStepId:1, scenario:{root, sharedStepScenarioSteps}}` |
| B3 | Шаг с ER (Alt+Enter) | `POST /api/sharedstep/step?afterId=1&withExpectedResult=true` | `{"bodyJson":{doc "Submit admin credentials"},"sharedStepId":1}` | контейнер ER id=3 |
| B3 | Строка ER | `POST /api/sharedstep/step?withExpectedResult=false` | `{"bodyJson":{doc "Admin dashboard opened"},"parentId":3,"sharedStepId":1}` | |
| B4 | В ТК: меню шага → Add new → Shared step → поиск | `GET /api/sharedstep?projectId=1&search=&archived=false&page=0&size=20` | | |
| B4 | выбор | `POST /api/testcase/step?afterId=1&withExpectedResult=false` | `{"sharedStepId":1,"testCaseId":1}` | `createdStepId:22` |
| B5 | Archive → диалог (показывает число использующих ТК) → Archive shared step | `POST /api/sharedstep/1/archive` | — | 202 |
| B5' | Unarchive (API) | `POST /api/sharedstep/1/unarchive` | — | 202 |
| B6 | Usage | `GET /api/sharedstep/1/usage` | | `{content:[{id, name, status, testLayer…}]}` |

**Соответствие тулам:**
- `create_shared_step` ✅ создаёт **пустой** shared step. Добавить в него шаги **нечем**: `POST /api/sharedstep/step` не выставлен (🕳 **критичный GAP**). Описание тула ("extract repeated test steps into a reusable library") обещает то, что сделать нельзя.
- Списка shared steps тоже нет: `listSharedSteps` (`GET /api/sharedstep?projectId`) есть в `src/api/shared-steps.ts:11`, но тулом не выставлен (🕳). Агент не может найти `sharedStepId` по имени.
- Вставка в ТК через `create_test_case_step(sharedStepId)` ✅ (UI добавляет `afterId`).
- `archive_shared_step`, `unarchive_shared_step`, `get_shared_step_usage`, `get_shared_step_steps` ✅.
- `deleteSharedStep` есть в `src/api/shared-steps.ts:55`, тулом не выставлен (UI тоже предлагает только Archive).
- В shared step при `withExpectedResult=true` контейнер ER создаётся **без** `expectedResultId:-1` в теле, в отличие от ТК.

---

## C. Запуски и ручное выполнение

### C1–C2. Ручной прогон ТК (карточка ТК → ⋯ → Run → диалог Launch/Job/Assign/Environment → Submit)

| # | UI-действие | Запрос | Request | Response |
|---|---|---|---|---|
| 1 | Открыть Launches | `GET /api/launch?page=0&size=25&projectId=1&preview=true&sort=createdDate,desc`, `/api/filter?type=LAUNCH`, `/api/ev?projectId=1` | | |
| 2 | ⋯ → Run (открытие диалога) | `POST /api/testcasetree/job` | `{"inverted":false,"groupsInclude":[],"groupsExclude":[],"leafsInclude":[1],"leafsExclude":[],"kind":"TreeSelectionDto","projectId":1,"path":[]}` | `[]` (нет автоджобов) |
| 3 | Submit | `POST /api/testcase/bulk/run` | `{"selection":{…TreeSelectionDto leafsInclude:[1]…},"launchName":"[MCP-RESEARCH] Manual run 1"}` | `{id:1, name, closed:false, autoclose:false}` |

Кнопки «+ Launch» на странице Launches **нет**: ручной launch в UI всегда создаётся из выбора ТК (`bulk/run`) или тест-плана.

**MCP-эквивалент** (проверено): `create_launch {name, projectId}` → 200 id=2, затем `add_test_cases_to_launch {selection:{projectId, leafsInclude:[1], inverted:false}}` → 202. Второй вызов с полным `TreeSelectionDto` тоже 202. Результаты появились асинхронно ✅. Атомарного `bulk/run` нет (🕳, необязательно).

### C3–C4. Открыть launch и результат

| UI | Запросы |
|---|---|
| Launch → Overview | `GET /api/launch/1`, `/progress`, `/statistic`, `/env`, `/job`, `/api/launch/quality-gate?launchId`, `/api/launch/error?launchId`, `/api/launch/attachment?launchId`, `/api/integration/project/1` |
| Tree | `GET /api/v2/launch/1/test-result/flat?page=0&size=100&treeId=0&sort=name,asc&deleted=false`; фильтры передаются как `search=<base64(JSON [{id,value,type}])>`, например `[{"id":"automated","value":false,"type":"boolean"},{"id":"progress","value":["in_progress"],"type":"testProgressStatusArray"}]` |
| Результат | `GET /api/testresult/1`, `/execution?v2=true` (**шаги прогона**), `/fixture?v2=true`, `/cfv`, `/evv`, `/issue`, `/members`, `/testkey`, `/history?size=5`, `/retries`, `/defect` |

`GET /api/testresult/{id}/execution?v2=true` — сценарий прогона со статусами шагов. Тула для него нет (🕳): `get_test_result` не показывает, какие шаги пройдены.

### C5–C6. Ручное выполнение (✓/✗ у шага → Passed / Failed внизу)

| # | UI-действие | Запрос | Request | Статус |
|---|---|---|---|---|
| 1 | Первый клик по шагу (автоназначение) | `POST /api/testresult/1/assign` | `{"username":"klumba"}` | 202 |
| 2 | ✓ у шага | — (только локальное состояние) | | |
| 3 | Кнопка Passed | `POST /api/testresult/1/resolve?v2=true` | `{"start":…,"stop":…,"duration":32318,"status":"passed","execution":{"status":"skipped","steps":[{"type":"body","body":"Open login page","status":"passed","start":…,"stop":…,"duration":17036,"expectedResultSteps":[{"type":"expected_body","body":"Login form is displayed","status":"skipped",…}],"steps":[]}, {"type":"body","body":"[SS name]","steps":[…shared step inline…]}, …, {"type":"attachment","attachmentId":1,…}]}}` | 202 |

Статусы шагов **не сохраняются по отдельности**: весь `execution` уходит одним `resolve?v2=true` в момент финального статуса.

**Контрольные проверки `resolve_test_result`:**

| Тест | Запрос | Результат |
|---|---|---|
| MCP-вызов на **открытом** результате #3 (7 шагов) | `POST /api/testresult/3/resolve {"status":"failed"}` (без `v2`) | 202, статус `failed`, **execution: 7 → 0 шагов** ❌ (сценарий прогона стёрт) |
| На **закрытом** результате #1 | `POST …/1/resolve {"status":"failed"}` и `…?v2=true {"status":"broken"}` | 202, статус **не изменился** (`passed`) — это и есть «KNOWN ISSUE» |
| Как UI (результат #4) | `GET …/4/execution?v2=true` → проставить `steps[i].status` → `POST …/4/resolve?v2=true {"status":"passed","execution":{"status":"passed","steps":[…]}}` | 202, статус `passed`, 7 шагов сохранены, у шага 1 `passed` ✅ |

**Вывод для `resolve_test_result`:** правильный порядок — `GET execution?v2=true` → изменить статусы → `resolve` с полным `execution`. Закрытый результат повторно не резолвится: нужен rerun.

> **Поправка (часть 5, сверка со схемой 26.3.1.2):** query-параметра `v2` у `POST /api/testresult/{id}/resolve` в схеме нет. Тело `ResolveRequestV2Dto{status*, message, trace, categoryId, start, stop, duration, execution}`. Проверено: `resolve` **без** `?v2`, но с `execution` → 202, статус сменён, 7 шагов сохранены. Шаги стирает именно отсутствие `execution`, а не отсутствие `v2`. UI шлёт `?v2=true` по привычке.

### C7. Rerun manually (кнопка на закрытом результате)

`POST /api/testresult/1/rerun {"username":"klumba"}` → `{"id":2}`: новый результат (retry) в статусе in progress с полным execution. Без тела → `400 Required request body is missing`. 🕳 GAP: без rerun агент не может перепрогнать закрытый результат.

### C8. Закрыть launch (иконка ⊡ в шапке launch)

`POST /api/launch/1/close` → 204 ✅ (`close_launch`). Меню ⋯ launch: Add test cases ▸, Edit, Copy link, Merge, Clone, Rerun job, Apply Defect matchers, Export ▸, Delete.

---

## D. Тест-планы

| # | UI-действие | Запрос | Request | Response |
|---|---|---|---|---|
| D1 | Открыть Test plans | `GET /api/testplan?projectId=1&sort=id,asc&page=0&size=25` | | список |
| D2 | `+ Test plan` (форма Name / Tree / Test cases query) | `GET /api/testcasetree/group?projectId=1…`, `GET /api/testcasetree/leaf?projectId=1…` | | превью кейсов |
| D2 | Name + AQL `tag = "smoke"` → Enter | `POST /api/testplan` | `{"projectId":1,"name":"[MCP-RESEARCH] TP smoke","baseRql":"tag = \"smoke\"","treeSelection":{"inverted":true,"groupsInclude":[],"groupsExclude":[],"leafsInclude":[],"leafsExclude":[],"kind":"TreeSelectionDto"}}` | `{id:1, testCasesCount:1}` |
| D2 | авто-открытие | `GET /api/testplan/1`, `/tree/group`, `/tree/leaf`, `/diff` (`{added, deleted}`) | | |
| D3 | ▷ Run → диалог (Name/Tags/Issues/Links/Environment) | `GET /api/testplan/1/job` | | |
| D3 | Submit | `POST /api/testplan/1/run` | `{"launchName":"[MCP-RESEARCH] TP run"}` | launch `{id:3, closed:false}` |

**Семантика `treeSelection` + `baseRql`** (проверено через API):

| Payload `create_test_plan` | `testCasesCount` |
|---|---|
| `{projectId, name}` | **2 = все кейсы проекта** ⚠️ |
| `{projectId, name, baseRql: "tag = \"smoke\""}` | 1 |
| `{projectId, name, treeSelection:{inverted:false, leafsInclude:[1,2], …}}` | 2 (явный список) |
| `{projectId, name, treeSelection:{inverted:true}}` | 2 (все) |

**Выводы:**
- В описании `create_test_plan` нет формы payload (⚠️). Нужно описать `baseRql` (AQL-фильтр), `treeSelection` (`inverted:true` + пустые списки = «всё, что подходит под baseRql»; `inverted:false` + `leafsInclude` = явный список) и предупредить, что `{name}` без фильтра включает **весь проект**.
- `run_test_plan {launchName}` ✅ совпадает с UI.
- Списка тест-планов нет: `GET /api/testplan?projectId` есть в `src/api/test-plans.ts:12`, но тулом не выставлен (🕳).

---

## E. Дефекты

| # | UI-действие | Запрос | Request | Response / статус |
|---|---|---|---|---|
| E1 | Открыть Defects | `GET /api/defect?projectId=1&sort=id,asc&nameFilter=&status=&page=0&size=25` | | |
| E2 | `+ Defect` → Name, Description, Create automation rule (Rule name, Error message pattern, Stack trace pattern) → Submit | `POST /api/defect` | `{"projectId":1,"name":"[MCP-RESEARCH] Login button broken","description":"Sign in does nothing","matcher":{"name":"login-timeout","messageRegex":".*Timeout.*login.*"}}` | `{id:1, closed:false, descriptionHtml}` |
| E2 | карточка | `GET /api/defect/1`, `/launch`, `/testcase`, `/testresult`, `/matcher` | | matcher хранится отдельно: `{id, defectId, name, messageRegex}` |
| E3 | Результат → Failed → диалог Resolution (Status/Category/Details) → Submit | `POST /api/testresult/6/resolve?v2=true` | `{"status":"failed","message":"Timeout waiting for login","start":…,"stop":…,"duration":14443}` | 202 |
| E4 | Link defect → диалог (Suggested / Select or create) | `GET /api/defect?projectId=1&nameFilter=&page=0&size=10`, `GET /api/testresult/6/defect/candidate?threshold=0.7&page=0&size=5` | | кандидаты |
| E4 | выбрать #1 → Link defect | `POST /api/testresult/6/defect/1` | `{"matcher":null}` | defect |
| E5 | Defects → чекбокс → Bulk actions → Close → Submit | `POST /api/defect/bulk/close` | `{"projectId":1,"selection":{"inverted":false,"ids":[1],"kind":"ListSelectionDto","projectId":1}}` | 202 |

**Контрольные проверки MCP:**

| Тул | Payload по описанию | Результат | Рабочий payload |
|---|---|---|---|
| `bulk_close_defects` | `{"ids":[1]}` | **400 `Missing target id parameter`** ❌ | `{"projectId":1,"selection":{"inverted":false,"ids":[1],"kind":"ListSelectionDto","projectId":1}}` → 202 |
| `bulk_reopen_defects` | `{"ids":[…]}` | (та же форма, что у close) ❌ | UI-форма → 202, `closed:false` ✅ |
| `link_defect_to_test_results` | `{"defectId":1,"testResultIds":[5]}` | **409 `ids must not be null; selection must not be null`** ❌ | `{"ids":[1],"selection":{"inverted":false,"leafsInclude":[5],"groupsInclude":[],"groupsExclude":[],"leafsExclude":[],"kind":"TreeSelectionDto","projectId":1,"launchId":2,"path":[]}}` → 204, связь появилась ✅ (`ids` — это **id дефектов**, результаты задаются в `selection.leafsInclude`, нужен `launchId`) |
| `link_defect_to_test_results`, вариант с `ListSelectionDto` | `{ids:[1], selection:{ids:[5], kind:"ListSelectionDto"}}` | 400 `Missing target id parameter` | — |
| `create_defect` | `{name, projectId, description}` | ✅. UI ещё передаёт `matcher {name, messageRegex, traceRegex}`: в описании не упомянуто (⚠️) | |
| `apply_defect_matchers` | `POST /api/launch/2/defect/apply` | 202 ✅ | |

Привязки одного дефекта к одному результату (`POST /api/testresult/{trId}/defect/{defectId} {"matcher":null}`) в MCP нет (🕳, удобная альтернатива bulk).

---

## F. Релизы (UI-раздела на klumba нет: проверено только через API)

| Тул | Запрос | Результат |
|---|---|---|
| `list_release_statuses` | `GET /api/project/release-status?projectId=1` | 200, `DRAFT…` ✅ |
| `list_release_workflows` | `GET /api/project/release-workflow?projectId=1` | 200, `Default` ✅ |
| `create_release` | `POST /api/release {projectId, name}` | **201** `{id:1, status:{code:DRAFT}, workflow:{id:1}}` ✅ |
| `add_launch_to_release` | `POST /api/release/1/launch/2` | 200 `{releaseId:1}` ✅ |
| `get_release_statistic` | `GET /api/release/1/statistic` | 200 `[]` ✅ |
| `list_releases` | `GET /api/release?projectId=1` | 200 ✅ |

---

## G. Прочие контрольные проверки

| Тул | Запрос | Результат |
|---|---|---|
| `search_test_cases` | `rql=tag = "smoke"` | 200, найден TC1 ✅ |
| `search_test_cases` | `rql=name ~ "MCP-RESEARCH"` | **400**: оператор `~` не поддерживается. Правильно `name ~= "…"` → 200 ✅ (сверить с `AQL_SYNTAX` в `src/tools/utils.ts`) |
| `create_test_case` (legacy `POST /api/testcase`) | `{projectId, name}` | 200, `Draft` ✅ |
| `create_test_case` | `{…, statusId:-3}` без `workflowId` | **400 `workflow and status are required`** ⚠️ |
| `create_test_case` | `{projectId, name, description, precondition, statusId:-3, workflowId:-1, testLayerId:-1, tags:[{name}]}` | 200: статус Active, слой Unit Tests, precondition и тег на месте ✅ |

---

## Итог: кандидаты на правку (вход для следующего этапа)

### ❌ Потеря или искажение данных (править код, а не только описание)

| # | Тул | Проблема | Как должно быть (по UI) | Где |
|---|---|---|---|---|
| 1 | `update_test_case_step` | `PATCH step/{id}` без `withExpectedResult` **удаляет ER** шага (UI так делает «Convert to Step»). Описание обещает обратное | `GET /step` → `expectedResultId` → `PATCH ?withExpectedResult=true {body, expectedResultId}`, если ER есть | `src/api/test-cases.ts:206`, `src/tools/test-cases.ts:222` |
| 2 | `create_test_case_step` с `expectedResult` | Создаётся пустой контейнер «Expected Result», **текст теряется** | `POST step?withExpectedResult=true {…, expectedResultId:-1}` → для каждой строки `POST step {parentId: expectedResultId, body}` | `src/tools/test-cases.ts:430` |
| 3 | `resolve_test_result` | `{status}` без `execution` **стирает шаги прогона** (7 → 0). На закрытом результате тихий no-op | `GET /testresult/{id}/execution?v2=true` → проставить `status` шагам → `POST /resolve {status, message?, start, stop, duration, execution:{status, steps}}` (`?v2` не нужен, см. часть 5). Для закрытого: `POST /rerun {username}` | `src/api/test-results.ts:67` |
| 4 | ~~`restore_test_cases_bulk`~~ **снято (часть 6): код MCP уже шлёт v1 `leafsInclude` + `deleted:true` и работает** | 400 без `deleted:true`, тихий no-op с ним. Причина: `testCasesInclude` в v1-DTO, где поле называется `leafsInclude` (часть 5) | `POST /api/v2/test-case/bulk/restore {selection:{projectId, testCasesInclude, inverted:false, deleted:true}}` **или** v1 с `{leafsInclude, deleted:true}` | `src/api/test-cases.ts:298` |
| 5 | `bulk_close_defects` / `bulk_reopen_defects` | Payload из описания `{ids}` → 400 | `{projectId, selection:{inverted:false, ids:[…], kind:"ListSelectionDto", projectId}}` | `src/tools/defects.ts:56-64` |
| 6 | `link_defect_to_test_results` | Payload из описания → 409 | `{ids:[defectId], selection:{kind:"TreeSelectionDto", projectId, launchId, leafsInclude:[trIds], inverted:false, …}}` | `src/tools/defects.ts:51` |

### 👻 Вводит в заблуждение

| # | Тул | Проблема | Рекомендация |
|---|---|---|---|
| 7 | `get_test_case_scenario` | `/scenario` всегда `{"steps":[]}` | Удалить или пометить deprecated и перенаправлять на `get_test_case_steps` |

### ⚠️ Описание неполное или неточное

| # | Тул | Что добавить |
|---|---|---|
| 8 | `set_test_case_tags` | **Полная замена**. Формат `[{id}]` или `[{name}]`, тег по имени создаётся автоматически. Для добавления использовать `add_test_case_tags_bulk` |
| 9 | `set_test_case_custom_fields` | Работает в режиме **append**. Значение по имени работает (создаёт или переиспользует). Удалить значение этим тулом нельзя. Системные поля: `-1 Epic, -2 Feature, -3 Story, -4 Component, -5 Suite` |
| 10 | `set_test_case_step_expected_result` | `body` **обязателен** (без него `400 step.onlyonedetail`). Сделать параметр required или подставлять текущий body из `get_test_case_steps` |
| 11 | `create_test_case` / `update_test_case` | Поля `statusId`, `testLayerId`, `workflowId`. При `statusId` в create нужен и `workflowId`. Справочники: статусы `-1 Draft, -2 Review, -3 Active, -4 Outdated`, слои `-1 Unit, -2 UI, -3 API` |
| 12 | `create_test_plan` | Описать `baseRql` + `treeSelection`; `{name}` без фильтра = весь проект |
| 13 | `create_defect` | Опциональный `matcher {name, messageRegex, traceRegex}` |
| 14 | `create_shared_step` | Явно сказать, что тул создаёт **пустой** shared step (шаги добавлять пока нечем, см. GAP) |
| 15 | `create_test_case_step` | Позиционирование: UI использует `afterId` (query). Без него шаг уходит в конец |
| 16 | AQL | `~` не работает, работает `~=` |

### 🕳 GAP: новые тулы, по приоритету

| Приоритет | Тул (предлагаемое имя) | Эндпоинт |
|---|---|---|
| P0 | `delete_test_case_step` | `DELETE /api/testcase/step/{id}` (каскадно с ER и детьми) |
| P0 | `create_shared_step_step` (+ update/delete) | `POST /api/sharedstep/step {sharedStepId, body\|bodyJson, parentId?}` `?afterId&withExpectedResult` |
| P0 | `list_shared_steps` | `GET /api/sharedstep?projectId&search&archived` (функция уже есть) |
| P0 | `list_project_custom_fields` | `GET /api/project/{id}/cf` (функция уже есть) или `GET /api/cf?projectId&v2=true` |
| P1 | `get_test_result_execution` | `GET /api/testresult/{id}/execution?v2=true` |
| P1 | `rerun_test_result` | `POST /api/testresult/{id}/rerun {username}` |
| P1 | `move_test_case_step` | `POST /api/testcase/step/{id}/move {parentId\|afterId\|beforeId}` |
| P1 | `list_test_plans` | `GET /api/testplan?projectId` (функция уже есть) |
| P1 | `create_custom_field_value` | `POST /api/project/{pid}/cfv {customField:{id}, name}` (для явного создания; bulk/add и так создаёт по имени) |
| P2 | `copy_test_case_step` | `POST /api/testcase/step/{id}/copy {afterId}` |
| P2 | `list_statuses` / `list_test_layers` / `list_workflows` | `GET /api/status?workflowId`, `GET /api/testlayer`, `GET /api/workflow` |
| P2 | `list_issue_integrations` | `GET /api/integration/suggest?operation=issue_suggest&projectId` (нужно для `set_test_case_issues`) |
| P2 | `link_defect_to_test_result` | `POST /api/testresult/{trId}/defect/{defectId} {matcher:null}` |
| P2 | `add_step_attachment` | `upload_test_case_attachment` → `POST /api/testcase/step {attachmentId, testCaseId}` |
| P2 | `run_test_cases` | `POST /api/testcase/bulk/run {selection, launchName}`: создаёт launch с результатами за один вызов |

### Эталонные последовательности для CUA (как это делает UI)

1. **Создать ТК со сценарием:** `create_test_case {projectId, name, description, precondition}` → для каждого шага по порядку и **строго последовательно**: `create_test_case_step {testCaseId, body}`. Для шага с ER: создать шаг, затем `set_test_case_step_expected_result {stepId, testCaseId, body, expectedResult}`. Сверить через `get_test_case_steps`.
2. **Поправить текст шага с ER:** `get_test_case_steps` → взять `expectedResultId` → PATCH с `withExpectedResult=true` и этим `expectedResultId` (после фикса #1 это будет делать сам `update_test_case_step`).
3. **Поправить строку ER:** `get_test_case_steps` → id дочернего узла контейнера → `update_test_case_step {stepId: leafId, body}`. У листа ER нет своего ER, поэтому потеря из #1 ему не грозит.
4. **Ручной прогон:** `create_launch` → `add_test_cases_to_launch` → (поиск результата в launch) → `assign_test_result` → `GET execution?v2=true` → `resolve?v2=true` с полным `execution` → `close_launch`.
5. **Custom field:** `list_project_custom_fields` (после выставления) → `set_test_case_custom_fields [{customField:{id}, values:[{name}]}]` (append).

---

## Тестовые данные

Всё создано в изолированном проекте `[MCP-RESEARCH] UI flows` (id=1) на `klumba.testops.cloud`: ТК 1–4, shared step 1, launches 1–3, test plans 1–5, defect 1, release 1. Чтобы убрать всё разом, удалите проект (Administration → Projects).

---

# Часть 2. Недостающие флоу и перепроверка (2026-10-29, второй проход)

Стенд и проект те же (`klumba`, проект 1). Метод тот же. Разделы ниже дополняют A–G.

## A9. Комментарии к тест-кейсу

| UI-действие | Запрос | Request | Ответ |
|---|---|---|---|
| Comments → текст → Leave a comment | `POST /api/comment` | `{"testCaseId":1,"body":"Research comment"}` | `{id:1, body, bodyHtml}` |
| загрузка | `GET /api/comment?testCaseId=1&page=0&size=25` | | |
| комментарий ⋯ → Delete (без подтверждения) | `DELETE /api/comment/1` | | 204 |
| комментарий ⋯ → Edit | (по аналогии `PATCH /api/comment/{id}`, не снят) | | |

🕳 GAP: `add_test_case_comment`, `list_test_case_comments`, `delete_test_case_comment`. Комментарии привязаны к **тест-кейсу**: на странице результата показываются они же (`GET /api/comment?testCaseId`).

## A5+. Members, Test keys, Relations

| Путь | Запрос | Request | Примечание |
|---|---|---|---|
| Members ✎ → Add → Role (`Lead`/`Owner`) → Member → Submit | `GET /api/user/suggest?roleId=-2&ignoreId=1&size=20` → `POST /api/testcase/1/members` | `[{"name":"klumba","role":{"id":-1,"name":"Owner"}},{"name":"klumba","role":{"id":-2}}]` | **полная замена** списка; роли: `-1 Owner`, `-2 Lead` (`GET /api/role`). 🕳 |
| Test keys ✎ → Add | `GET /api/integration/suggest?operation=test_key_sync&projectId=1` | — | без интеграции добавить нельзя |
| Relations ✎ → Add → Type → Test Case → Submit | `GET /api/testcase/suggest?ignoreId=1&projectId=1&size=20` → `POST /api/testcase/1/relation` | `[{"type":"related to","target":{"id":4}}]` | полная замена; типы: `related to`, `clones`/`is cloned by`, `duplicates`/`is duplicated by`, `automates`/`is automated by`, … 🕳 |

⚠️ Диалоги с подсказками интеграций (Issues, Test keys) при активном перехватчике **дважды вешали вкладку**, поэтому эти флоу сняты до момента открытия.

## A11–A15. Меню «⋯» карточки

| Пункт | Запрос | Request | Тул / статус |
|---|---|---|---|
| Manage links → Add (Link text, URL) → Submit | `PATCH /api/testcase/1` | `{"links":[{"name":"Spec","url":"https://example.com/spec"}]}` | `update_test_case` ✅ (полная замена `links`) |
| Edit parameters → Add parameter → значения → Combine → Submit | `POST /api/testcase/example/nwise?n=1` → `POST /api/testcase/1/example` | `[{"name":"browser","values":["firefox","chrome"]}]` → `[[{"name":"browser","value":"firefox"}],[{"name":"browser","value":"chrome"}]]` | 🕳 (комбинации ≤ 50) |
| Clone → Name suffix / Workflow / Clone options / Clone to another project → Clone | `POST /api/cfproject/delta?toProjectId=1&testCaseId=1` → `POST /api/testcase/1/clone?id=1` | `{"nameSuffix":"(clone)","strategy":"EXCLUDE","toProjectId":1,"testCaseId":1,"cfMapping":{}}` | 🕳 **очень полезно**: клон (#5) получил шаги с ER, shared step, вложения, теги, ссылки, участников, параметры; статус сброшен в Draft |
| Version history | `GET /api/testcase/1/version`, `GET /api/testcase/version/{vid}/data` | | |
| Version history → Save (имя, описание) | `POST /api/testcase/1/version` | `{"title":"v1-research","description":""}` | лимит 10 версий |
| Version history → Restore (версия совпадает с текущей) | — | | проверка на клиенте: «Version … is equal to the current version» |
| Change log (вкладка) | `GET /api/testcase/audit?testCaseId=1&page=0&size=25` (+ `GET /api/cfv/{id}`, `/api/tag/{id}`, `/api/status/{id}`, `/api/member/{id}` для расшифровки) | | 🕳 `get_test_case_audit`: удобно для проверки после записи |
| History / Attachments / Mutes / Defects (вкладки) | `GET /api/testcase/1/history?page&size`, `GET /api/testcase/attachment?testCaseId`, `GET /api/mute?testCaseId`, `GET /api/testcase/1/defect` | | ✅ / mutes и defects 🕳 |

## A19. Вкладка Attachments

| Действие | Запрос | Примечание |
|---|---|---|
| 🗑 у вложения (без подтверждения) | `DELETE /api/testcase/attachment/2` | ✅ `delete_test_case_attachment`. **Каскад:** узел сценария `{attachmentId:2}` удалился вместе с вложением |

## A20. Секции тест-кейса и поле `expectedResult` уровня кейса

Settings → **Test case sections**: чекбоксы `Precondition` и `Expected result` (по умолчанию выключены). Именно поэтому в A4 карточка не показывала Precondition.

| Действие | Запрос | Request |
|---|---|---|
| включить Precondition | `POST /api/projectproperty` | `{"name":"testcase.sections.precondition.enabled","projectId":1,"value":"1"}` |
| включить Expected result | `POST /api/projectproperty` | (аналогично) |
| карточка → Expected result ✎ → Save | `PATCH /api/testcase/3` | `{"id":3,"expectedResult":"Overall: user is logged in"}` → в ответе `expectedResultHtml` |

⚠️ **Есть два разных ER:** поле кейса `testcase.expectedResult` (простой текст, через `update_test_case`) и ER шагов (узлы-контейнеры, см. A3). Это нужно развести в описаниях, иначе агент путает их. Если секции выключены, поля всё равно пишутся через API, но UI их не показывает.

## A16. Bulk-действия в списке ТК (чекбоксы → панель «Selected: N» → ⋯)

Общий `selection`: `{"inverted":false,"groupsInclude":[],"groupsExclude":[],"testCasesInclude":[3,4],"testCasesExclude":[],"leavesInclude":[3,4],"leavesExclude":[],"projectId":1,"deleted":false}`. При каждом изменении выделения UI шлёт `POST /api/v2/test-case/bulk/count {selection}` → `{total}`.

| Пункт меню | Запрос | Тело (кроме `selection`) | MCP |
|---|---|---|---|
| Layer | `POST /api/v2/test-case/bulk/layer/set` | `{"layerId":-3}` | 🕳 |
| Status (Workflow + Status) | `GET /api/workflow/suggest`, `GET /api/status/suggest?workflowId=-1` → `POST /api/v2/test-case/bulk/status/set` | `{"workflowId":-1,"statusId":-2}` | 🕳 |
| Test plan (создать из выделения) | `POST /api/v2/test-case/bulk/test-plan/create` | `{"testPlanName":"…"}` → тест-план `{id:6, baseRql:"true"}` | 🕳 |
| Add metadata → Tags / Custom field values / Members / Issues / Links | `…/bulk/tag/add`, `…/bulk/cfv/add`, `POST /api/v2/test-case/bulk/member/add {"members":[{"role":{"id":-2},"id":2}]}`, `…/bulk/issue/add`, `…/bulk/external-link/add` | | tags/cfv/links ✅ (перепроверено), members/issues 🕳 |
| Remove metadata → Tags / Custom field values / Members / Issues | диалог CFV сначала зовёт `POST /api/v2/test-case/bulk/cfv {selection}` (текущие значения). Удаление CFV: `POST /api/v2/test-case/bulk/cfv/remove {selection, ids:[cfvId]}` → 204 (проверено API; с `cfv:[…]` → 409 `ids must not be null`) | | tags ✅, **cfv remove 🕳** (закрывает пробел «удалить значение CF») |
| Clone test cases | `POST /api/v2/test-case/bulk/cf/delta` → `POST /api/v2/test-case/bulk/clone` | `{"nameSuffix":"(clone)","strategy":"EXCLUDE","toProjectId":1,"cfMapping":{},"ignoreScenario":true}` (снятая опция превращается в `ignore<Option>:true`) → 202 | 🕳 |
| Move to project | (не снят) | | |
| Mute | `POST /api/v2/test-case/bulk/mute/add` | `{"mute":{"name":"flaky env","reason":"Unstable stand"}}` | 🕳 |
| Export ▸ | (не снят: выгрузка файла) | | |
| Move to trash | `POST /api/v2/test-case/bulk/remove` | `{selection}` (`deleted:false`) → 204 | 🕳 bulk delete |
| Trash → строка ⋯ → **Delete permanently** → «Yes, delete» | `POST /api/v2/test-case/bulk/remove` | `selection.deleted:true` → 204 (безвозвратно) | 🕳 |

**Перепроверка bulk-тулов MCP** (тела как в `src/api/test-cases.ts:313-390`):

| Тул | Результат |
|---|---|
| `add_test_case_tags_bulk` `tags:[{name:"regression"}]` | 200, тег создан и добавлен ✅ |
| `add_test_case_tags_bulk` `tags:[{id:1}]` | 200 ✅ |
| `remove_test_case_tags_bulk` `ids:[1]` | 204, снят ✅ |
| `add_test_case_external_links_bulk` | 200, ссылки добавлены ✅ |

## A18. Деревья (группировка по custom fields)

| Действие | Запрос | Примечание |
|---|---|---|
| All test cases ▾ → Features | `GET /api/tree/1`, `GET /api/v2/tree/1`, `GET /api/v2/project/1/test-case/tree/tree-node?treeId=1&page=0&size=100…` | деревья: `0`=плоский список, `1`=Features (Feature → Story), `2`=Suites |
| раскрыть папку | `GET …/tree/tree-node?parentNodeId=6&treeId=1…` | |
| `+ Feature` → имя → Enter | `PUT /api/v2/project/1/test-case/tree/group?treeId=1 {"name":"Payments"}` | → `{customFieldId:-2, customFieldValueId:4, id:56, type:"GROUP"}`: папка = **значение CF** |
| в папке «Test Case or create Story» → `+ Test Case` → имя → Enter | `POST /api/v2/project/1/test-case/tree/leaf?treeId=1&nodeId=56 {"name":"…"}` | ТК #9 сразу получает Feature=Payments 🕳 (альтернатива `create_test_case` + `set_test_case_custom_fields`) |

## C9–C16. Запуски: недостающие действия

| Действие | Запрос | Request | MCP |
|---|---|---|---|
| ⋯ → Edit (Name/Tags/Issues/Links) → Submit | `PATCH /api/launch/3` | **полный объект launch** (`autoclose, closed, links:[{name,url}], name, tags, issues, releases…`) | `update_launch` (перепроверено: частичный `{name}` → 200, `closed`/`links` не тронуты ✅) |
| ⋯ → Clone (Copy Launch: Launch/Assign) → Submit | `POST /api/launch/3/copy` | `{"launchName":"… copy","issues":[],"tags":[],"links":[…]}` → 202 | 🕳 |
| ⋯ → Merge → Target launch → Submit | `GET /api/launch/suggest?projectId=1&ignoreId=3` → `POST /api/launch/merge` | `{"from":3,"to":4}` → исходный launch **исчезает** (404) | 🕳 |
| ⊡ (закрытый launch: ▷) → Reopen | `POST /api/launch/1/reopen` | `{}` → 204 | `reopen_launch` ✅ |
| ⋯ → Add test cases ▸ From test cases / **From test plans** / From test result files | `POST /api/launch/1/testplan/add` | `{"testPlanId":6}` → 202 | `add_test_plan_to_launch` ✅ |
| ⋯ → Delete → «Deleted launches can't be restored» | `DELETE /api/launch/4` | → 204 | `delete_launch` ✅ |
| Run ТК с Environment (Run → Environment → Add → Browser → «chrome» create) | `GET /api/ev/suggest`, `GET /api/evv/suggest?envVarId=-1&projectId=1&query=chrome` → `POST /api/evv {"name":"chrome","variable":{"id":-1}}` → `POST /api/testcase/bulk/run` | `{…, "envVarValueSets":[{"values":[{"variable":{"id":-1},"id":1}]}]}` | 🕳 `create_env_var_value`; форма `envVarValueSets` та же, что у `run_test_plan` / `add_test_plan_to_launch` |
| Результат → Mute → Name/Reason/Issues → Submit | `POST /api/testresult/6/mute` | `{"name":"known issue","reason":"Tracked by defect 1"}` → 202 | 🕳 |
| Результат → Unmute | `POST /api/testresult/6/unmute` | UI шлёт **полный объект test result** → 202. По схеме тела нет; проверено: без тела → 202, `muted:false` (часть 5) | 🕳 |

Меню ⋯ launch: Add test cases ▸, Edit, Copy link, Merge, Clone, Rerun job, Apply Defect matchers, Export ▸, Delete. Close/Reopen — это иконка ⊡/▷ в шапке.

## D4–D7. Тест-планы: недостающие действия

| Действие | Запрос | Request | MCP |
|---|---|---|---|
| Страница плана: «2 test cases **+4**» | `GET /api/testplan/2/diff` → `{added, deleted}` | | план — это **снимок**, новые подходящие ТК в него сами не попадают |
| ⋯ → Sync test cases → Sync | `POST /api/testplan/2/sync` | → `{testCasesCount:6}` | 🕳 **важно**: без sync `run_test_plan` запускает устаревший набор |
| ⋯ → Edit → снять чекбокс TC2 → Submit | `PATCH /api/testplan/2` | `{"name":"…","treeSelection":{"inverted":true,…,"leafsInclude":[2],…}}` → count 5 | `update_test_plan` ✅. **При `inverted:true` поле `leafsInclude` означает ИСКЛЮЧЕННЫЕ** |
| ⋯ → Delete → «Deleted test plans can't be restored» | `DELETE /api/testplan/2` | → 204 | `delete_test_plan` ✅ |

Меню ⋯ плана: Edit, Sync test cases, Reset jobs to primary, Delete.

## E6–E12. Дефекты: недостающие действия

| Действие | Запрос | Request | MCP |
|---|---|---|---|
| Automation rules `+` → Rule name / Error message pattern / Stack trace pattern → Save rule | `POST /api/defect/matcher` | `{"name":"npe-rule","messageRegex":".*NullPointer.*","defectId":1}` | 🕳 |
| 🗑 у правила (без подтверждения) | `DELETE /api/defect/matcher/2` | | 🕳 |
| ⋯ → Rename | `PATCH /api/defect/1` | `{"name":"… v2"}` | `update_defect` ✅ |
| ⋯ → **Close** (одиночный) | `PATCH /api/defect/1` | `{"closed":true}` | `update_defect {closed:true}` ✅: проще, чем bulk |
| ⋯ → Reopen | `PATCH /api/defect/1` | `{"closed":false}` | ✅ |
| ⋯ → Delete → подтверждение | `DELETE /api/defect/2` | → 204 | 🕳 `delete_defect` |
| ⋯ → Create issue / Link issue | (нужна интеграция) | | |

Меню ⋯ дефекта: Close/Reopen, Rename, Create issue, Link issue, Delete.

## G2. Дашборды и виджеты

| Действие | Запрос | Request | MCP |
|---|---|---|---|
| Dashboards (пусто) → шаблон Automation | `POST /api/dashboard` | `{"projectId":1,"name":"Dashboard","templateId":-1}` → 4 виджета | `create_dashboard` ✅ (`templateId` в описании не упомянут ⚠️) |
| загрузка виджетов | `GET /api/widget/{id}/data[?dateFrom=2026-10-16&dateTo=2026-10-29&offset=-3][&page&size]` | | `get_widget_data` ✅ (даты необязательны: без них 200) |
| `+ Widget` → Test Case Pie Chart → Group By / AQL → Add widget | `GET /api/testcase/query/validate?projectId=1&rql=…` (на каждый ввод) → `POST /api/widget` | `{"dashboardId":1,"type":"tc_pie_chart","gridPos":{"x":0,"y":10000,"w":6,"h":6},"name":"…","options":{"tcRql":"tag = \"regression\"","groupBy":"status"}}` | 🕳 `create_widget` |

Типы виджетов: Text Block, Launch Analytics, Launch Trend (by date), Test Case Pie Chart (`groupBy`: automation/status/last execution status), Automation Trend, Low Performing Tests, Test Case Tree Map Chart, Launches, …

**`GET /api/testcase/query/validate?projectId&rql`** проверяет AQL и считает совпадения (UI показывает «matches: 6 test cases»). 🕳 Очень полезен агенту перед `search_test_cases` и `create_test_plan`.

Перепроверка: `copy_dashboard` 200, `update_dashboard` 200, `delete_dashboard` 202 ✅.

## S. Настройки проекта (Settings)

Разделы: General, Access, Webhooks, Custom Fields, Environment, Error categories, Roles, Trees, Test case sections, Workflows, Upload, Launches, Integrations, Issues.

| Раздел | Запросы | Вывод для MCP |
|---|---|---|
| Custom Fields | `GET /api/cf?projectId=1&page&size&sort=name,asc&v2=true`, `GET /api/cfschema/count-mappings?projectId&id`; `+ Field` → `GET /api/cf/suggest?excludeProjectId=1` | новое поле создаётся **глобально** (Administration), в проект только подключается. Вне скоупа |
| Environment | `GET /api/evschema?projectId=1` → `browser → Browser`, `os → OS` | `list_env_var_schemas` ✅ |
| Test case sections | `GET/POST /api/projectproperty` | см. A20 |
| Workflows | `GET /api/workflowschema?projectId=1` | |
| Trees | `GET /api/tree?projectId=1&withArchived=true`, `GET /api/v2/tree?…`, `GET /api/testplan?projectId=1&treeId=…` | |
| Integrations | `GET /api/integration/project/1`, `…/available` | интеграций нет, поэтому issues, test keys и jobs недоступны |
| Jobs (сайдбар) | `GET /api/job?projectId=1`, `GET /api/integration/project/1` | нужна CI-интеграция |

## R. Перепроверка существующих тулов

### Read-эндпоинты (все GET из `src/api/*.ts`, параметры как у тулов)

60 из 64 — 200. Расхождения:

| Тул | Запрос | Результат | Вывод |
|---|---|---|---|
| `find_similar_failures` | `GET /api/testresult/defect/match` без `launchId` | 400 `Required request parameter 'launchId'` | `launchId` в схеме помечен `.optional()`, а он обязателен ⚠️ |
| `find_similar_failures` | `?launchId=2` / `?launchId=2&defectId=1` | **400 `at least one of messageRegex/traceRegex parameters should be specified`** | ❌ **с текущей схемой тул не работает никогда**. Рабочий вариант: `?launchId=2&messageRegex=.*Timeout.*` → 200 `[{id:6, message, status:"failed"}]`. Нужны параметры `messageRegex`/`traceRegex`, `defectId` не используется |
| `list_env_var_values` | `GET /api/evv` без `envVarId` | 400 | в схеме тула `envVarId` обязателен ✅ (с ним 200) |
| `get_release_test_case_tree` | без `sort` | 400 `unsupported sort field "name"` | ⚠️ серверная сортировка по умолчанию ломается. С `sort=id,asc` → 200. Нужно ставить sort по умолчанию в тул |
| `get_release_test_case_selection` | релиз без selection | 404 `ReleaseTestCaseSelection not found` | ⚠️ это норма для нового релиза, описать в тексте тула |

### Write-тулы

| Тул | Payload (как в MCP) | Результат |
|---|---|---|
| `update_launch` | `{name}` | 200, остальные поля сохранены ✅ |
| `update_test_plan` | `{name}` | 200 ✅. `testCasesCount` пересчитался (1→2) |
| `update_shared_step` | `{name}` | 200 ✅ |
| `update_defect` | `{description}` | 200 ✅ |
| `update_release` | `{name}` | 200 ✅ |
| `set_release_tags` | `[{name:"rc"}]` | 200, тег создан ✅ |
| `update_release_test_case_selection` | `{testCaseAql}` | 202 `{releaseId, taskId}` (асинхронно) ✅ |
| `create_release_from_test_cases` | `{release:{name}, selection:{projectId, inverted:false, leafsInclude:[1,4]}}` | 200 `{releaseId:2, taskId:2}` ✅ |
| `create_test_result` | `{name, launchId, testCaseId, status:"passed", projectId}` | 200 ✅ |
| `update_test_result` | GET + merge `{status:"failed", message}` + PATCH | **200, но status и message не изменились** ❌ (тихий no-op даже на «свежем» результате). Статус менять только через `resolve` (с `execution`). По схеме `TestResultPatchDto` вообще не содержит `status`/`message` |
| `copy_dashboard` / `update_dashboard` / `delete_dashboard` | | 200 / 200 / 202 ✅ |

### Повтор критичных находок части 1 (на свежем клоне TC5)

| Проверка | Результат |
|---|---|
| `update_test_case_step(body)` без флага на шаге с ER#30 | ER **удалён** ❌ (воспроизводится) |
| `create_test_case_step(expectedResult:"A; B")` | создан пустой `ER#50`, текст потерян ❌ (воспроизводится) |
| `restore_test_cases_bulk` v1 + `deleted:true` (ручное тело с `testCasesInclude`, не как в коде) | 204, `deleted:true` остался ❌ (воспроизводится) |
| v2 `/api/v2/test-case/bulk/restore` | 204, `deleted:false` ✅ |

---

## Дополнения к итоговому списку правок

### ❌ Добавить к разделу «Потеря или искажение данных / не работает»

| # | Тул | Проблема | Как должно быть |
|---|---|---|---|
| 17 | `find_similar_failures` | Без `messageRegex`/`traceRegex` всегда 400; `launchId` помечен optional | Схема: `launchId` (required), `messageRegex?`, `traceRegex?` (хотя бы один). Можно подставлять regex из матчеров дефекта (`GET /api/defect/{id}/matcher`) при переданном `defectId` |
| 18 | `update_test_result` | PATCH с merged-объектом молча игнорирует `status`/`message` | Убрать `status` из описания или перенаправлять на `resolve` (поля нет в `TestResultPatchDto`; `name*` обязателен) |

### ⚠️ Описания

| # | Тул | Что добавить |
|---|---|---|
| 19 | `create_test_case` / `update_test_case` | Различать `expectedResult` кейса (простое поле) и ER шагов. Precondition/ER видны в UI только при включённых секциях проекта (`projectproperty`) |
| 20 | `update_test_plan` / `run_test_plan` | План — **снимок**. Перед `run_test_plan` нужен sync (после добавления тула), иначе новые ТК не попадут. `inverted:true` + `leafsInclude` = исключения |
| 21 | `get_release_test_case_tree` | По умолчанию передавать `sort=id,asc` |
| 22 | `get_release_test_case_selection` | 404 — нормальное состояние для релиза без selection |
| 23 | `create_dashboard` | `templateId` (−1 = Automation) создаёт готовые виджеты |
| 24 | `update_defect` | `{closed:true|false}` — одиночное закрытие и переоткрытие (проще bulk) |

### 🕳 Новые GAP (второй проход)

| Приоритет | Тул | Эндпоинт |
|---|---|---|
| P0 | `clone_test_case` | `POST /api/testcase/{id}/clone {nameSuffix, strategy:"EXCLUDE", toProjectId, testCaseId, cfMapping, ignore*}` — копирует сценарий с ER целиком |
| P0 | `remove_test_case_custom_field_values_bulk` | `POST /api/v2/test-case/bulk/cfv/remove {selection, ids:[cfvId]}` |
| P0 | `sync_test_plan` | `POST /api/testplan/{id}/sync` (+ `GET /api/testplan/{id}/diff`) |
| P0 | `validate_aql` | `GET /api/testcase/query/validate?projectId&rql` |
| P1 | `delete_test_cases_bulk` | `POST /api/v2/test-case/bulk/remove {selection[, deleted:true]}` |
| P1 | `set_test_case_status_bulk` / `set_test_case_layer_bulk` | `…/bulk/status/set {workflowId, statusId}`, `…/bulk/layer/set {layerId}` |
| P1 | `add/list/delete_test_case_comment` | `POST /api/comment {testCaseId, body}`, `GET /api/comment?testCaseId`, `DELETE /api/comment/{id}` |
| P1 | `set_test_case_members` (+bulk) | `POST /api/testcase/{id}/members [{name, role:{id}}]`, `…/bulk/member/add` |
| P1 | `set_test_case_relations` | `POST /api/testcase/{id}/relation [{type, target:{id}}]` |
| P1 | `set_test_case_parameters` | `POST /api/testcase/example/nwise?n=1` → `POST /api/testcase/{id}/example` |
| P1 | `get_test_case_audit` | `GET /api/testcase/audit?testCaseId` |
| P1 | `create/delete_defect_matcher` | `POST /api/defect/matcher {name, messageRegex, traceRegex?, defectId}`, `DELETE /api/defect/matcher/{id}` |
| P1 | `delete_defect` | `DELETE /api/defect/{id}` |
| P1 | `mute_test_result` / `unmute_test_result`, `mute_test_cases_bulk` | `POST /api/testresult/{id}/mute {name, reason}`, `…/unmute` (полный объект), `…/bulk/mute/add {mute:{name, reason}}` |
| P2 | `copy_launch` / `merge_launches` | `POST /api/launch/{id}/copy {launchName, tags, issues, links}`, `POST /api/launch/merge {from, to}` |
| P2 | `create_test_plan_from_test_cases` | `POST /api/v2/test-case/bulk/test-plan/create {selection, testPlanName}` |
| P2 | `clone_test_cases_bulk` | `POST /api/v2/test-case/bulk/clone {…, ignoreScenario…}` |
| P2 | `create_test_case_in_tree` / `create_tree_group` | `POST /api/v2/project/{pid}/test-case/tree/leaf?treeId&nodeId {name}`, `PUT …/tree/group?treeId {name}` |
| P2 | `save_test_case_version` | `POST /api/testcase/{id}/version {title, description}` |
| P2 | `create_widget` | `POST /api/widget {dashboardId, type, gridPos, name, options}` |
| P2 | `create_env_var_value` | `POST /api/evv {name, variable:{id}}` |
| P2 | `set_project_property` | `POST /api/projectproperty {name, projectId, value}` (секции precondition/expected result) |

### Не покрыто (причина)

- Upload/Import результатов (Launches → Import, Add test cases → From test result files): нужен файл отчёта.
- Export (ТК, launch): скачивание файла.
- Move to project: проект один.
- Issues / Test keys / Create issue / Jobs / Rerun job: нет интеграций с трекером и CI.
- Webhooks, Roles, Access, Error categories, Upload, Launches (настройки) и Administration: админская конфигурация, вне скоупа MCP.
- Edit комментария, перемещение ТК между папками дерева drag-n-drop: не снято.

---

# Часть 3. Добивка оставшихся флоу (2026-10-29, третий проход)

Разрешения пользователя в этом проходе: **Export (скачивание)** и **Import результатов** — разрешены. **Создание интеграции** (трекер/CI) — не разрешено, поэтому Issues / Test keys / Jobs сняты только до точки, где UI требует интеграцию, а API-поведение issue-тулов зафиксировано без неё.

## A9+. Правка комментария

| UI | Запрос | Request |
|---|---|---|
| комментарий ⋯ → Edit → правка → Save | `PATCH /api/comment/2` | **полный объект комментария**: `{"body":"Comment to edit (edited)","bodyHtml":"<p>Comment to edit</p>\n","createdBy","createdDate","id":2,"testCaseId":1,…}` → ответ с новым `bodyHtml`. По схеме `CommentPatchDto{body}`; проверено: `{body}` → 200 (часть 5) |

## A18+. Дерево: перенос ТК между папками и переименование папки

| UI | Запрос | Request | Результат |
|---|---|---|---|
| drag ТК из корня на папку «Payments» | `POST /api/v2/test-case/tree/bulk/drag-and-drop` | `{"nodeId":56,"selection":{"inverted":false,"leavesInclude":["22"],"groupsInclude":[],"leavesExclude":[],"groupsExclude":[],"projectId":1,"treeId":1}}` → 202 | TC3 получил `Feature: Payments`. ⚠️ `leavesInclude` — **id узлов дерева** (строки), не id ТК |
| папка ⋯ → Rename (двойной клик) → имя → Enter | `PUT /api/v2/project/1/test-case/tree/group/56/name` | `{"name":"Payments v2"}` | `customFieldValueId` сменился 4 → **5**: переименование создаёт/переназначает значение CF для всех ТК папки |

Меню ⋯ папки: Select, Rename, Focus, Run, Clone test cases, Move to project, Export ▸, Move to trash.

## A21. Move to project

Подготовка: создан второй проект `[MCP-RESEARCH] move target` (id=34) через `POST /api/project`.

| UI | Запрос | Request | Результат |
|---|---|---|---|
| строка ТК ⋯ → Move to project | `POST /api/v2/test-case/bulk/count` | `{selection}` | |
| выбор проекта | `GET /api/project/suggest?ignoreId=1&size=20` → `GET /api/project/34` → `POST /api/v2/test-case/bulk/cf/delta` | `{"toProjectId":34,"selection":{…}}` → `[]` (расхождений CF нет) | |
| Submit | `POST /api/v2/test-case/bulk/move` | `{"selection":{…,"testCasesInclude":[2]},"strategy":"EXCLUDE","cfMapping":{},"toProjectId":34}` → 202 | TC2 `projectId=34` ✅. 🕳 GAP `move_test_cases_to_project` |

`bulk/cf/delta` возвращает custom fields, которых нет в целевом проекте; UI тогда просит маппинг (`cfMapping`).

## A22. Export тест-кейсов

| UI | Запрос | Request / Response |
|---|---|---|
| bulk ⋯ → Export ▸ (PDF / CSV) → CSV | `GET /api/cf?projectId=1&v2=true`, `GET /api/integration/suggest?operation=issue_sync&projectId=1`, `GET /api/export/testcase/csv/mapping` | диалог: File name, Column separator, Customize export |
| Submit | `POST /api/v2/test-case/bulk/export/csv` | `{"selection":{…},"mapping":[{"field":"allure_id","name":"allure_id"},{"field":"name",…},"full_name","automated","description","precondition","expected_result","status","scenario","tag",…], …}` → `{"id":1,"name":"report.csv","status":"queued","type":"TEST_CASE_CSV",…}` |
| ожидание | `GET /api/export/1` (опрос до `READY`) | |
| Download (ссылка) | `GET /api/export/download/1` | `text/csv`, заголовок: `allure_id;name;full_name;automated;description;precondition;expected_result;status;scenario;tag;link;example;parameter;Lead;Owner;Suite;Component;Story;Feature;Epic` |

🕳 GAP `export_test_cases_csv`: асинхронный, `export → poll → download`. Это готовый способ массового чтения сценариев.

## C17. Export launch

| UI | Запрос |
|---|---|
| launch ⋯ → Export ▸ → CSV → Submit | `GET /api/export/testresult/csv/mapping` → `POST /api/export/testresult/csv {mapping:[allure_id,name,full_name,description,status,start,stop,duration,precondition,expected_result,message,test_case_id,test_case_status,layer,scenario,…], …}` → `{id:2, status:"queued"}` → дальше `GET /api/export/{id}`, `GET /api/export/download/{id}` |

## C18. Import результатов (новый launch)

| UI | Запрос | Request | Результат |
|---|---|---|---|
| Launches → Import → диалог «Upload files» (Name, Tags, Issues, Links, Environment; Results files / Archives (only zip)) | | | |
| выбор файла `r1-result.json` (allure-results формат: `uuid, historyId, name, fullName, status, statusDetails{message,trace}, stage, start, stop, labels[], steps[]`) → Upload files | `POST /api/launch/upload` | multipart `info` (JSON с name/tags/…) + `file` → `{"filesCount":1,"launchId":6,"testSessionId":11}` | launch #6 `[MCP-RESEARCH] Imported`, результат #13 `failed`. **Автоматически создан automated-ТК #10** |

## C19–C20. Launch → Add test cases ▸ From test cases / From test result files

| UI | Запрос | Request | MCP |
|---|---|---|---|
| From test cases → диалог (вкладки Test cases / Job / Assign / Environment, фильтры Status/Type/Layer/Role members/Tag) → чекбокс TC1 → Submit | `POST /api/launch/6/testcase/add` | `{"selection":{"inverted":false,"groupsInclude":[],"groupsExclude":[],"leafsInclude":[1],"leafsExclude":[],"kind":"TreeSelectionDto","projectId":1}}` → 202 | `add_test_cases_to_launch` ✅ (форма совпадает) |
| From test result files → Environment variables + файл → Upload files | `POST /api/launch/6/upload` | multipart `info` + `file` → 202 `{filesCount:1, launchId:6}` | 🕳 `upload_launch_results` |

## R+. Перепроверка на импортированном результате

| Тул | Запрос | Результат |
|---|---|---|
| `apply_defect_matchers` | `POST /api/launch/6/defect/apply` | 202, через ~3 с результат #13 («Timeout waiting for login (imported)») привязан к дефекту 1 по матчеру `.*Timeout.*login.*` ✅ |
| `get_launch_defects` | `GET /api/launch/6/defect` | 200 `[{id:1, count:1}]` ✅ |
| `find_similar_failures` (с regex) | `GET /api/testresult/defect/match?launchId=6&messageRegex=.*Timeout.*` | 200 `[13:failed]` ✅ (без regex — 400, см. часть 2) |

## R+. Issue-тулы без интеграции (фактический ответ API)

| Тул | Payload | Результат |
|---|---|---|
| `get_test_case_issues` | — | 200 `[]` ✅ |
| `set_test_case_issues` | `[{name:"JIRA-1"}]` | **200 `[]` — тихо проигнорировано** ❌ (без интеграции issue не сохраняется, ошибки нет) |
| `set_test_case_issues` | `[{name:"JIRA-1", integrationId:999}]` | 409 `id must not be null or empty` |
| `set_test_case_issues` | `[]` | 200 `[]` (очистка) |
| `link_issue_to_defect` | `{name:"JIRA-1"}` | 409 `integrationId must not be null` |
| `unlink_issue_from_defect` | — | 200 (возвращает дефект) |

Вывод: issue-тулы требуют существующую интеграцию (`integrationId` из `GET /api/integration/project/{id}` или `GET /api/integration/suggest?operation=issue_suggest`). `set_test_case_issues` без неё возвращает 200 и пустой массив — описание должно требовать read-back.

## Итог по покрытию

| Флоу | Статус |
|---|---|
| Все пункты меню ТК, шагов, bulk, дерева, папок | ✅ сняты |
| Launch: создание (run/import), edit, copy, merge, reopen/close, delete, add (tc / plan / files), export | ✅ |
| Результат: assign, step statuses, pass/fail, rerun, mute/unmute, link defect | ✅ |
| Тест-план: create, edit, sync, run, delete | ✅ |
| Дефект: create (+matcher), rename, close/reopen (одиночно и bulk), matchers add/delete, link, delete | ✅ |
| Shared steps: create, steps, ER, insert, archive/unarchive | ✅ |
| Dashboards / widgets / AQL validate | ✅ |
| Export ТК и launch, Import результатов | ✅ |
| Move to project | ✅ |
| **Issues / Test keys / Create issue / Jobs / Rerun job** | ⛔ **не снято: требуют интеграцию с трекером/CI, создание интеграции пользователь не разрешил**. Зафиксированы запросы до точки отказа и фактическое поведение API (см. выше) |
| Administration (глобальные CF, роли, интеграции), Webhooks, Access | ⛔ админская конфигурация вне скоупа MCP |

### Дополнения к списку правок (часть 3)

| # | Тип | Тул / предложение | Суть |
|---|---|---|---|
| 25 | ❌ | `set_test_case_issues` | 200 + `[]` без интеграции — тихий no-op. Описание: нужен `integrationId`, обязателен read-back |
| 26 | ⚠️ | `link_issue_to_defect` | `integrationId` обязателен — добавить в описание и схему |
| 27 | 🕳 P1 | `move_test_cases_to_project` | `bulk/cf/delta` → `POST /api/v2/test-case/bulk/move {selection, strategy:"EXCLUDE", cfMapping, toProjectId}` |
| 28 | 🕳 P1 | `export_test_cases_csv` / `export_launch_csv` | `POST /api/v2/test-case/bulk/export/csv` / `POST /api/export/testresult/csv` → `GET /api/export/{id}` → `GET /api/export/download/{id}` |
| 29 | 🕳 P1 | `upload_launch_results` | `POST /api/launch/upload` (новый) / `POST /api/launch/{id}/upload` (в существующий), multipart `info` + `file` (allure-results JSON/zip) |
| 30 | 🕳 P2 | `move_test_cases_in_tree` / `rename_tree_group` | `POST /api/v2/test-case/tree/bulk/drag-and-drop {nodeId, selection{leavesInclude:[nodeIds]}}`, `PUT …/tree/group/{id}/name` |
| 31 | 🕳 P2 | `update_test_case_comment` | `PATCH /api/comment/{id}` (полный объект) |

---

# Часть 4. Access, Webhooks, Administration (только чтение)

Создание интеграций, вебхуков, токенов и приглашений — это изменение постоянной конфигурации. Пользователь дважды отказался создавать интеграцию (в том числе «Custom Integration» без внешнего сервера). Поэтому в этой части снято только чтение.

## Project Settings → Access

| Вкладка | Запросы |
|---|---|
| Collaborators | `GET /api/project/access/1/collaborator?page=0&size=25`, `GET /api/permissionset/suggest?sort=system,name,asc&size=2000` (роли проекта: Owner, …) |
| Groups | `GET /api/project/access/1/group?page=0&size=25` |
| Access tokens | `GET /api/token?projectId=1` (пусто; кнопка `+ Token`) |

## Project Settings → Webhooks

`GET /api/notification/webhook?projectId=1&page=0` → пусто (кнопка `+ Webhook`).

## Administration (`/admin`)

| Раздел | Запрос |
|---|---|
| Members (Members / Guests / Invites / Deactivated, Invite people) | `GET /api/admin/account/info`, `GET /api/admin/account/member?sort=firstName,lastName,username,asc` |
| Groups | `GET /api/accessgroup` |
| Roles | `GET /api/role` (роли участников ТК: `-1 Owner`, `-2 Lead`) |
| Global Permissions | `GET /api/globalsettings` |
| Status | `GET /api/status` (глобальные статусы ТК) |
| Workflow | `GET /api/workflow` |
| Test Layer | `GET /api/testlayer` |
| Custom Fields | `GET /api/cf?archived=false&sort=lastModifiedDate,desc&v2=true` (+ счётчики archived) — **здесь создаются глобальные CF** |
| Environment | `GET /api/ev` |
| Error categories | `GET /api/category`, `GET /api/categorymatcher` |
| Integrations | `GET /api/integration`; `Add integration` → `GET /api/integration/available?query=` (типы: Allure TestOps, Asana, AWS, Azure DevOps Server, Bamboo CI, Bitbucket, CircleCI, ClickUp, **Custom Integration**, GitHub, GitLab, Jenkins, Jira, YouTrack, Redmine, …) |
| Cleanup policies | `GET /api/cleanerschema/global` |
| License | (данные из `GET /api/v2/license`) |
| Permission Sets | `GET /api/permissionset?sort=system,id` |
| User Display | `GET /api/globalsettings/user-display-mode` |

Справочные эндпоинты Administration (`/api/status`, `/api/workflow`, `/api/testlayer`, `/api/role`, `/api/cf`) — это те самые источники id для `statusId`, `workflowId`, `testLayerId`, ролей участников и `customField.id`, которых не хватает MCP (см. GAP «справочники» в части 1).

## Не покрыто по решению пользователя

| Флоу | Чего не хватает | Что зафиксировано |
|---|---|---|
| Issues (ТК, launch, mute), Create issue / Link issue (дефект) | интеграции трекера | запросы до точки отказа (`GET /api/integration/suggest?operation=issue_suggest|issue_sync`) и фактическое поведение API без интеграции (часть 3: `set_test_case_issues` → 200 + `[]`, `link_issue_to_defect` → 409 `integrationId must not be null`) |
| Test keys | интеграции с `test_key_sync` | `GET /api/integration/suggest?operation=test_key_sync` |
| Jobs, Rerun job, вкладка Job в Run | CI-интеграции | `GET /api/job?projectId`, `POST /api/testcasetree/job` → `[]` |
| Создание токенов, вебхуков, приглашений, глобальных CF/статусов/workflow | постоянная конфигурация инстанса | только чтение (выше) |

---

# Часть 5. Сверка с OpenAPI-схемой 26.3.1.2 (`sw.json`)

**Источник:** `sw.json` (OpenAPI 3.1.0, `allure-testops-service` **26.3.1.2**, commit `cd7fae27`): 622 пути, 853 схемы. Совпадает с `supportedApiVersion` в `package.json`.

**Методика:**
1. Каждый вызов `client.<method>(path)` из `src/api/*.ts` (126 уникальных пар метод+путь) найден в схеме: есть ли путь, метод, `deprecated`, обязательные query, DTO тела.
2. Каждый эндпоинт, упомянутый в журнале (189 уникальных пар), проверен так же.
3. Каждый из **114 тулов** связан через handler → функцию `src/api` → эндпоинт(ы). Ниже итоговая таблица.
4. Спорные места, где журнал и схема расходились, перепроверены вживую на `klumba` (проект 1).

## Результат сверки эндпоинтов

| Набор | Всего | Нет в схеме | Нет метода | `deprecated` |
|---|---|---|---|---|
| Эндпоинты MCP (`src/api`) | 126 | 0 | 0 | 1: `GET /api/testcase/{id}/scenario` |
| Эндпоинты журнала | 189 | 0 | 1: `POST /api/testcase/{id}/cfv` (в схеме только GET и PATCH) | 2: `GET /api/cf`, `GET /api/testcase/{id}/scenario` |

Все эндпоинты-GAP из журнала (clone, move, copy, merge, sync, mute, matcher, comment, members, relation, version, export, upload, tree, widget, projectproperty…) **есть в схеме**: это официальные, просто не выставленные в MCP ручки.

## Поправки к журналу по результатам сверки (с живой проверкой)

| # | Где в журнале | Было | Стало (схема + проверка) |
|---|---|---|---|
| P1 | C6, итог #3, эталон 4 | «нужен `resolve?v2=true`» | В схеме `v2` у `resolve` нет. `resolve` **без** `?v2`, но с `execution` → 202, статус сменён, 7 шагов сохранены. Шаги стирает отсутствие `execution` |
| P2 | A8, итог #4 | v1 `bulk/restore` «тихий no-op» | Причина — поле: v1 `TestCaseTreeSelectionDto` знает `leafsInclude`, а не `testCasesInclude`. v1 с `{leafsInclude:[13], deleted:true}` → 204, восстановлен; без `deleted` → 400 |
| P3 | A6 (Submit CF) | `POST /api/testcase/{id}/cfv` как штатный путь | POST **недокументирован**. Документированный `PATCH /api/testcase/{id}/cfv [CustomFieldWithValuesDto{customField, values[]}]` → **500** на любые тела (by name, by id, пустой values). Рабочие пути: недокументированный POST (full replace) или bulk `cfv/add` / `cfv/remove` |
| P4 | A1 | `GET /api/cf?projectId&v2=true` — список CF проекта | В схеме `deprecated`. Замена — `GET /api/project/{projectId}/cf` (функция `listProjectCustomFields` в MCP уже на ней) |
| P5 | A3.2, A3.4 | UI шлёт `expectedResultId` | Поля **нет** в `ScenarioStepCreateDto`/`ScenarioStepPatchDto`: недокументированное, но рабочее. В схеме у create есть query `beforeId`/`afterId`/`withExpectedResult`, у patch — только `withExpectedResult` |
| P6 | C15 | unmute «полным объектом» | По схеме тела нет. `POST /api/testresult/{id}/unmute` без тела → 202, `muted:false` |
| P7 | A9+ | PATCH комментария «полным объектом» | По схеме `CommentPatchDto{body}`. `{body}` → 200 |
| P8 | Память и описание `create_test_case` («steps игнорируются») | — | Уточнено: в `TestCaseCreateV2Dto`/`TestCasePatchV2Dto` **есть** `scenario{steps:[BodyStepDto{body, bodyJson, steps, expectedResultSteps}, SharedStepStepDto, AttachmentStepDto, ExpectedBodyStepDto]}`. Живая проверка: структура узлов создаётся, но **текст всегда `<empty>`** (и с `body`, и с `bodyJson`), ER-контейнеры и shared step **не** создаются. `PATCH {scenario}` **заменяет весь сценарий** пустыми узлами ⇒ опасно |
| P9 | C7 rerun | «тело обязательно» | В схеме `TestResultRerunDto{username}` без required. На практике `{}` → **500**, без тела → 400. `username` фактически обязателен |

## Новые расхождения, найденные только сверкой со схемой

| # | Тул | Схема | Живая проверка | Статус |
|---|---|---|---|---|
| N1 | `get_widget_data` | `GET /api/widget/{id}/data?parameters*` (`MultiValueMap`) | Тул шлёт `from`/`to` (мс) → **игнорируются**, сервер отдаёт период по умолчанию (14 дней). Работают `dateFrom`/`dateTo` в формате `YYYY-MM-DD` (+ `offset`, `page`, `size`, как шлёт UI) | ❌ |
| N2 | `get_automation_chart`, `get_statistic_trend`, `get_tc_success_rate` | `offset`: `string`, `format: byte` | Описание тула: «Timezone offset in **minutes**». `offset=-180` → **400**; `-3`/`3`/`0` → 200. Это **часы** (−128..127) | ⚠️ |
| N3 | `find_similar_failures` | `launchId*` required; `messageRegex`, `traceRegex`; **`defectId` нет** | Тул: `launchId` optional, есть несуществующий `defectId`, нет regex-полей | ❌ (уточняет #17) |
| N4 | `update_test_result` | `TestResultPatchDto` **без** `status`/`message`, `name*` required | — | ❌ (подтверждает #18 на уровне схемы) |
| N5 | `create_test_case_step` | `ScenarioStepCreateDto` **без** `expectedResult` | — | ❌ (объясняет #2: поле просто неизвестно серверу) |
| N6 | `copy_dashboard` | `DashboardCopyDto.preserveWidgetAql*` required | без него 200 | ⚠️ передавать явно |
| N7 | `create_release` | `ReleaseCreateDto` **без** `projectId`, query тоже нет | тул добавляет `projectId` в тело → 201, релиз в нужном проекте | ⚠️ схема неполная, поведение рабочее |
| N8 | `link_issue_to_defect` | `DefectIssueLinkDto{integrationId*, name*}` | без интеграции 409 | ⚠️ |
| N9 | `create_defect` | `DefectCreateDto{name*, projectId*, description, matcher{name*, messageRegex, traceRegex}, linkIssue{integrationId*, name*}, issue}` | — | ⚠️ описание тула неполное |
| N10 | `delete_test_case` | `DELETE /api/testcase/{id}?force` | без `force` soft delete (A8) | ✅ (`force=true` → безвозвратно, не выставлено) |

## Подтверждено схемой (журнал корректен)

- **`DefectBulkDto{projectId*, selection*:ListSelectionDto{ids, inverted}}`**: правильная форма для `bulk_close/reopen/remove` (E5).
- **`TestResultBulkEntityIdsDto{ids*, selection*:TestResultTreeSelectionDto{launchId, leafsInclude…}}`**: правильная форма для `link_defect_to_test_results` (E5).
- **`TestCaseSelectionDtoV2`** (v2 bulk) использует `testCasesInclude`; **`TestCaseTreeSelectionDto`** (v1: launch add, release create, bulk run, testplan) использует `leafsInclude`; **`TestCaseTreeSelectionDtoV2`** (drag-and-drop) — `leavesInclude`. Три разных имени поля: это первопричина путаницы с selection.
- `TestCaseRelationTypeDto`: `related to`, `clones`, `is cloned by`, `duplicates`, `is duplicated by`, `automates`, `is automated by` (A5+).
- `TestCaseBulkCfMoveStrategy`: `ADD`, `MAP`, `EXCLUDE`, `REWRITE` (clone/move).
- `TestStatus`: `failed`, `broken`, `passed`, `skipped`, `unknown`.
- `AnalyticInterval`: `hour`, `day`, `week`, `month` (совпадает с тулами ✅).
- `TestCaseCloneRqDto` и `TestCaseBulkCloneDtoV2`: `ignoreAttachments/Cfv/IssueLinks/Links/Members/Parameters/Relations/Scenario/Tags/TestKeys`, `statusId`, `workflowId`, `strategy`, `cfMapping`, `toProjectId`, `nameSuffix` (A13, A16).
- `POST /api/launch/upload`: multipart `info*:LaunchCreateAndUploadDto{name*, projectId*, tags, issues, links, envVarValues}` + `file[]`/`archive[]`; `POST /api/launch/{id}/upload`: `info*:LaunchExistingUploadDto{envVarValues}` (C18–C20).
- `PUT /api/v2/project/{projectId}/test-case/tree/group?treeId*&parentNodeId`, `POST …/tree/leaf?treeId*&nodeId`, `PUT …/tree/group/{groupId}/name` (A18).
- `POST /api/testcase/step/{id}/copy` и `/move`: `{afterId, beforeId, parentId}` (A3.6, A3.8).
- `POST /api/v2/test-case/bulk/export/csv?shared` и `POST /api/export/testresult/csv?shared`: `{columnSeparator, mapping[]}` (A22, C17).

## Сверка 114 реализованных MCP-тулов: тул ↔ эндпоинт ↔ схема ↔ журнал

Легенда последней колонки: ❌ сломан или теряет данные (подтверждено вживую), ⚠️ работает, но описание или схема расходятся, ✅ подтверждено, 👻 deprecated/бесполезен. Ссылки в скобках ведут на разделы журнала.

| Домен | Тул | Эндпоинт(ы) | Схема 26.3.1.2 | Живая проверка / журнал |
|---|---|---|---|---|
| analytic | `get_automation_chart` | `GET /api/analytic/{projectId}/automation_chart` | ✅ | ⚠️ `offset` — часы (`byte`), не минуты: `-180` → 400 (часть 5) |
| analytic | `get_group_by_automation` | `GET /api/analytic/{projectId}/group_by_automation` | ✅ | ✅ 200 в read-прогоне (R) |
| analytic | `get_group_by_status` | `GET /api/analytic/{projectId}/group_by_status` | ✅ | ✅ 200 в read-прогоне (R) |
| analytic | `get_launch_duration_histogram` | `GET /api/analytic/{projectId}/launch_duration_histogram` | ✅ | ✅ 200 в read-прогоне (R) |
| analytic | `get_mute_trend` | `GET /api/analytic/{projectId}/mute_trend` | ✅ | ✅ 200 в read-прогоне (R) |
| analytic | `get_statistic_trend` | `GET /api/analytic/{projectId}/statistic_trend` | ✅ | ⚠️ `offset` — часы, не минуты (часть 5); `from`/`to`/`interval` ✅ |
| analytic | `get_tc_last_result` | `GET /api/analytic/{projectId}/tc_last_result` | ✅ | ✅ 200 в read-прогоне (R) |
| analytic | `get_tc_success_rate` | `GET /api/analytic/{projectId}/tc_success_rate` | ✅ | ⚠️ `offset` — часы, не минуты (часть 5) |
| dashboards | `create_dashboard` | `POST /api/dashboard` | ✅ | ✅; `templateId` не описан (G2) |
| dashboards | `get_dashboard` | `GET /api/dashboard/{id}` | ✅ | ✅ 200 в read-прогоне (R) |
| dashboards | `update_dashboard` | `PATCH /api/dashboard/{id}` | ✅ | ✅ подтверждено |
| dashboards | `delete_dashboard` | `DELETE /api/dashboard/{id}` | ✅ | ✅ подтверждено |
| dashboards | `copy_dashboard` | `POST /api/dashboard/{id}/copy` | ✅ | ⚠️ `preserveWidgetAql*` обязателен по схеме, но без него 200 (R) |
| dashboards | `get_widget_data` | `GET /api/widget/{widgetId}/data` | ✅ | ❌ `from`/`to` (ms) игнорируются; работают `dateFrom`/`dateTo` (YYYY-MM-DD) через `parameters` (часть 5) |
| defects | `get_defect` | `GET /api/defect/{id}` | ✅ | ✅ подтверждено |
| defects | `create_defect` | `POST /api/defect` | ✅ | ⚠️ схема: `matcher{name*, messageRegex, traceRegex}`, `linkIssue{integrationId*, name*}`, `issue` — не описаны в туле |
| defects | `update_defect` | `PATCH /api/defect/{id}` | ✅ | ✅ подтверждено |
| defects | `get_defect_test_results` | `GET /api/defect/{id}/testresult` | ✅ | ✅ 200 в read-прогоне (R) |
| defects | `get_defect_test_cases` | `GET /api/defect/{id}/testcase` | ✅ | ✅ 200 в read-прогоне (R) |
| defects | `get_defect_launches` | `GET /api/defect/{id}/launch` | ✅ | ✅ 200 в read-прогоне (R) |
| defects | `get_launch_defects` | `GET /api/launch/{launchId}/defect` | ✅ | ✅ подтверждено |
| defects | `find_similar_failures` | `GET /api/testresult/defect/match` | ✅ | ❌ `launchId*` обязателен в схеме, тул — optional; `messageRegex`/`traceRegex` в тул не выведены; `defectId` в схеме отсутствует (R) |
| defects | `link_defect_to_test_results` | `POST /api/testresult/bulk/defect/link` | ✅ | ❌ описание `{defectId, testResultIds}`; схема `TestResultBulkEntityIdsDto{ids*, selection*{launchId, leafsInclude…}}` (E5) |
| defects | `bulk_close_defects` | `POST /api/defect/bulk/close` | ✅ | ❌ описание `{ids}`; схема `DefectBulkDto{projectId*, selection*{ids, inverted}}` (E5) |
| defects | `bulk_reopen_defects` | `POST /api/defect/bulk/reopen` | ✅ | ❌ то же, что close (E5) |
| defects | `link_issue_to_defect` | `POST /api/defect/{defectId}/issue` | ✅ | ⚠️ `integrationId*` обязателен (R+) |
| defects | `unlink_issue_from_defect` | `DELETE /api/defect/{defectId}/issue` | ✅ | ✅ подтверждено |
| defects | `apply_defect_matchers` | `POST /api/launch/{launchId}/defect/apply` | ✅ | ✅ подтверждено |
| environments | `suggest_env_vars` | `GET /api/ev/suggest` | ✅ | ✅ 200 в read-прогоне (R) |
| environments | `suggest_env_var_values` | `GET /api/evv/suggest` | ✅ | ✅ 200 в read-прогоне (R) |
| environments | `list_env_var_schemas` | `GET /api/evschema` | ✅ | ✅ 200 в read-прогоне (R) |
| environments | `list_env_var_values` | `GET /api/evv` | ✅ | ✅ 200 в read-прогоне (R) |
| environments | `get_test_result_env_vars` | `GET /api/testresult/{testResultId}/evv` | ✅ | ✅ 200 в read-прогоне (R) |
| launches | `search_launches` | `GET /api/launch/__search` | ✅ | ✅ подтверждено |
| launches | `get_launch` | `GET /api/launch/{id}` | ✅ | ✅ 200 в read-прогоне (R) |
| launches | `create_launch` | `POST /api/launch` | ✅ | ✅ подтверждено |
| launches | `update_launch` | `PATCH /api/launch/{id}` | ✅ | ✅ подтверждено |
| launches | `delete_launch` | `DELETE /api/launch/{id}` | ✅ | ✅ подтверждено |
| launches | `close_launch` | `POST /api/launch/{id}/close` | ✅ | ✅ подтверждено |
| launches | `reopen_launch` | `POST /api/launch/{id}/reopen` | ✅ | ✅ подтверждено |
| launches | `get_launch_statistic` | `GET /api/launch/{id}/statistic` | ✅ | ✅ 200 в read-прогоне (R) |
| launches | `get_launch_progress` | `GET /api/launch/{id}/progress` | ✅ | ✅ 200 в read-прогоне (R) |
| launches | `add_test_cases_to_launch` | `POST /api/launch/{id}/testcase/add` | ✅ | ✅ подтверждено |
| launches | `add_test_plan_to_launch` | `POST /api/launch/{id}/testplan/add` | ✅ | ✅ подтверждено |
| releases | `list_releases` | `GET /api/release` | ✅ | ✅ подтверждено |
| releases | `get_release` | `GET /api/release/{id}` | ✅ | ✅ 200 в read-прогоне (R) |
| releases | `create_release` | `POST /api/release` | ✅ | ⚠️ `projectId` отсутствует в `ReleaseCreateDto`, но сервер его принимает (201) (F) |
| releases | `update_release` | `PATCH /api/release/{id}` | ✅ | ✅ подтверждено |
| releases | `delete_release` | `DELETE /api/release/{id}` | ✅ | схема ✅, MCP-вызов не выполнялся (UI-эквивалент снят) |
| releases | `get_release_statistic` | `GET /api/release/{id}/statistic` | ✅ | ✅ подтверждено |
| releases | `list_release_defects` | `GET /api/release/{id}/defects` | ✅ | ✅ 200 в read-прогоне (R) |
| releases | `list_release_muted_results` | `GET /api/release/{id}/muted` | ✅ | ✅ 200 в read-прогоне (R) |
| releases | `get_release_test_case_tree` | `GET /api/release/{id}/test-case/tree` | ✅ | ⚠️ без `sort` → 400 `unsupported sort field "name"` (R) |
| releases | `list_release_tags` | `GET /api/release/{releaseId}/tag` | ✅ | ✅ 200 в read-прогоне (R) |
| releases | `set_release_tags` | `POST /api/release/{releaseId}/tag` | ✅ | ✅ подтверждено |
| releases | `add_launch_to_release` | `POST /api/release/{releaseId}/launch/{launchId}` | ✅ | ✅ подтверждено |
| releases | `remove_launch_from_release` | `DELETE /api/release/{releaseId}/launch/{launchId}` | ✅ | схема ✅, MCP-вызов не выполнялся (UI-эквивалент снят) |
| releases | `get_release_test_case_selection` | `GET /api/release/{releaseId}/test-case/selection` | ✅ | ⚠️ 404 для релиза без selection (R) |
| releases | `update_release_test_case_selection` | `PATCH /api/release/{releaseId}/test-case/selection` | ✅ | ✅ подтверждено |
| releases | `create_release_from_test_cases` | `POST /api/test-case/bulk/release/create` | ✅ | ✅ подтверждено |
| releases | `list_release_statuses` | `GET /api/project/release-status` | ✅ | ✅ подтверждено |
| releases | `list_release_workflows` | `GET /api/project/release-workflow` | ✅ | ✅ подтверждено |
| shared-steps | `get_shared_step` | `GET /api/sharedstep/{id}` | ✅ | ✅ подтверждено |
| shared-steps | `get_shared_step_steps` | `GET /api/sharedstep/{id}/step` | ✅ | ✅ подтверждено |
| shared-steps | `get_shared_step_usage` | `GET /api/sharedstep/{id}/usage` | ✅ | ✅ подтверждено |
| shared-steps | `create_shared_step` | `POST /api/sharedstep` | ✅ | ⚠️ создаёт пустой shared step; шаги — `POST /api/sharedstep/step` (🕳) |
| shared-steps | `update_shared_step` | `PATCH /api/sharedstep/{id}` | ✅ | ✅ подтверждено |
| shared-steps | `archive_shared_step` | `POST /api/sharedstep/{id}/archive` | ✅ | ✅ подтверждено |
| shared-steps | `unarchive_shared_step` | `POST /api/sharedstep/{id}/unarchive` | ✅ | ✅ подтверждено |
| test-cases | `search_test_cases` | `GET /api/testcase/__search` | ✅ | ✅ подтверждено |
| test-cases | `find_test_cases` | `GET /api/testcase/__search` | ✅ | ✅ 200 в read-прогоне (R) |
| test-cases | `get_test_case` | `GET /api/testcase/{id}` | ✅ | ✅ 200 в read-прогоне (R) |
| test-cases | `create_test_case` | `POST /api/testcase` | ✅ | ⚠️ `scenario` в `TestCaseCreateV2Dto` есть, но текст шагов теряется (`<empty>`), ER/shared не создаются (часть 5); `statusId` требует `workflowId` (G) |
| test-cases | `create_test_case_step` | `POST /api/testcase/step` | ✅ | ❌ при `expectedResult` текст теряется: поля `expectedResult` нет в `ScenarioStepCreateDto` (A3.2); `afterId`/`beforeId` есть в схеме, тул их не поддерживает |
| test-cases | `set_test_case_step_expected_result` | `PATCH /api/testcase/step/{stepId} + POST /api/testcase/step` | ✅ | ⚠️ без `body` → 400 `step.onlyonedetail`; append (A3.3) |
| test-cases | `update_test_case_step` | `PATCH /api/testcase/step/{stepId}` | ✅ | ❌ удаляет ER (A3.4, R); в схеме `ScenarioStepPatchDto` нет `expectedResultId` — UI шлёт его недокументированно |
| test-cases | `update_test_case` | `PATCH /api/testcase/{id}` | ✅ | ⚠️ `scenario` в PATCH **заменяет весь сценарий пустыми узлами** (часть 5); `links`/`tags` — full replace |
| test-cases | `delete_test_case` | `DELETE /api/testcase/{id}` | ✅ | ✅ подтверждено |
| test-cases | `add_test_case_tags_bulk` | `POST /api/v2/test-case/bulk/tag/add` | ✅ | ✅ подтверждено |
| test-cases | `restore_test_cases_bulk` | `POST /api/testcase/bulk/restore` | ✅ | ✅ код шлёт v1 `{leafsInclude, deleted:true}` — проверено вживую (часть 6). Прежний ❌ был ошибкой исследования |
| test-cases | `remove_test_case_tags_bulk` | `POST /api/v2/test-case/bulk/tag/remove` | ✅ | ✅ подтверждено |
| test-cases | `add_test_case_external_links_bulk` | `POST /api/v2/test-case/bulk/external-link/add` | ✅ | ✅ подтверждено |
| test-cases | `get_test_case_overview` | `GET /api/testcase/{testCaseId}/overview` | ✅ | ✅ подтверждено |
| test-cases | `get_test_case_history` | `GET /api/testcase/{id}/history` | ✅ | ✅ 200 в read-прогоне (R) |
| test-cases | `get_test_case_scenario` | `GET /api/testcase/{id}/scenario` | ⚠️ deprecated | 👻 `deprecated` в схеме; всегда `{"steps":[]}` (A3.9) |
| test-cases | `get_test_case_steps` | `GET /api/testcase/{id}/step` | ✅ | ✅ подтверждено |
| test-cases | `get_test_case_tags` | `GET /api/testcase/{testCaseId}/tag` | ✅ | ✅ подтверждено |
| test-cases | `set_test_case_tags` | `POST /api/testcase/{testCaseId}/tag` | ✅ | ⚠️ полная замена; `[{id}|{name}]` (A5) |
| test-cases | `get_test_case_issues` | `GET /api/testcase/{testCaseId}/issue` | ✅ | ✅ подтверждено |
| test-cases | `set_test_case_issues` | `POST /api/testcase/{testCaseId}/issue` | ✅ | ❌ без `integrationId` 200 + `[]` (тихий no-op) (R+) |
| test-cases | `restore_test_case` | `POST /api/testcase/{id}/restore` | ✅ | ✅ подтверждено |
| test-cases | `list_custom_field_values` | `GET /api/project/{projectId}/cfv` | ✅ | ✅ подтверждено |
| test-cases | `get_test_case_custom_fields` | `GET /api/testcase/{testCaseId}/cfv` | ✅ | ✅ подтверждено |
| test-cases | `set_test_case_custom_fields` | `POST /api/v2/test-case/bulk/cfv/add` | ✅ | ✅ append; по имени работает (A6). Снятие — только bulk/cfv/remove (🕳) |
| test-cases | `list_test_case_attachments` | `GET /api/testcase/attachment` | ✅ | ✅ подтверждено |
| test-cases | `upload_test_case_attachment` | `POST /api/testcase/attachment` | ✅ | схема ✅, MCP-вызов не выполнялся (UI-эквивалент снят) |
| test-cases | `delete_test_case_attachment` | `DELETE /api/testcase/attachment/{attachmentId}` | ✅ | ✅ подтверждено |
| test-cases | `get_test_case_attachment_content` | `GET /api/testcase/attachment/{attachmentId}/content` | ✅ | ✅ подтверждено |
| test-plans | `get_test_plan` | `GET /api/testplan/{id}` | ✅ | ✅ подтверждено |
| test-plans | `create_test_plan` | `POST /api/testplan` | ✅ | ⚠️ `{name}` без фильтра = весь проект; `inverted:true` + `leafsInclude` = исключения (D) |
| test-plans | `update_test_plan` | `PATCH /api/testplan/{id}` | ✅ | ✅ (D6); план — снимок, нужен sync (🕳) |
| test-plans | `delete_test_plan` | `DELETE /api/testplan/{id}` | ✅ | ✅ подтверждено |
| test-plans | `run_test_plan` | `POST /api/testplan/{id}/run` | ✅ | ✅ подтверждено |
| test-results | `list_test_results` | `GET /api/testresult` | ✅ | ✅ 200 в read-прогоне (R) |
| test-results | `search_test_results` | `GET /api/testresult/__search` | ✅ | ✅ подтверждено |
| test-results | `get_test_result` | `GET /api/testresult/{id}` | ✅ | ✅ 200 в read-прогоне (R) |
| test-results | `create_test_result` | `POST /api/testresult` | ✅ | ✅ подтверждено |
| test-results | `update_test_result` | `PATCH /api/testresult/{id}` | ✅ | ❌ `TestResultPatchDto` не содержит `status`/`message` → смена статуса невозможна (R) |
| test-results | `get_test_result_history` | `GET /api/testresult/{id}/history` | ✅ | ✅ 200 в read-прогоне (R) |
| test-results | `assign_test_result` | `POST /api/testresult/{id}/assign` | ✅ | ✅ подтверждено |
| test-results | `resolve_test_result` | `POST /api/testresult/{id}/resolve` | ✅ | ❌ без `execution` стирает шаги (C6); `?v2` в схеме нет и не нужен (проверено, часть 5) |
| test-results | `get_test_result_retries` | `GET /api/testresult/{id}/retries` | ✅ | ✅ 200 в read-прогоне (R) |
| test-results | `list_test_result_attachments` | `GET /api/testresult/attachment` | ✅ | ✅ 200 в read-прогоне (R) |
| test-results | `get_test_result_attachment_content` | `GET /api/testresult/attachment/{attachmentId}/content` | ✅ | схема ✅, MCP-вызов не выполнялся (UI-эквивалент снят) |

**Итог по 114 тулам:** схема ✅ у 113, ⚠️ deprecated у 1 (`get_test_case_scenario`). По живой проверке: ❌ 11, ⚠️ 15, ✅ остальные.

---

# Часть 6. Статус исправлений в коде MCP (2026-10-29)

Исправлено в `src/api/*.ts` и `src/tools/*.ts`. Unit-тесты на точные URL и тела — `tests/unit/ui-flow-fixes.unit.test.ts`; 29 тестов, все зелёные. Полный прогон зелёный: `npx vitest run` — 14 файлов, 184 теста (включая integration); `eslint` — 0 ошибок; `tsc` собирается. Устаревшие тесты, которые ссылались на удалённые `list_*` тулы и старые тексты ошибок валидации, обновлены (unit `test-cases`/`test-plans`/`test-results`/`launches`/`utils`, integration `launches`/`test-cases`/`test-plans`). Живая проверка — **скомпилированные функции из `dist/api`**, загруженные в страницу klumba поверх fetch-клиента с XSRF, проект 1.

## Поправка к журналу

`restore_test_cases_bulk` **не был сломан**: `src/api/test-cases.ts` (`restoreTestCases`) уже шлёт v1 `{selection:{projectId, deleted:true, leafsInclude, inverted:false}}`. В части 1 я проверял вручную составленное тело с `testCasesInclude`, а не то, что шлёт тул. Повторная живая проверка кода: удалить ТК #46 → `restoreTestCases` → `deleted:false` ✅. Сломанных тулов было **10**, а не 11.

## Сломанные тулы → исправление → живая проверка

| Тул | Что сделано | Живая проверка (klumba) |
|---|---|---|
| `get_test_case_scenario` | alias `GET /api/testcase/{id}/step` (deprecated `/scenario` больше не вызывается) | ✅ возвращает дерево |
| `create_test_case_step` | ER: `POST ?withExpectedResult=true {…, expectedResultId:-1}` + по строке `POST {parentId: container}` с цепочкой `afterId`; новые `afterId`/`beforeId` | ✅ ТК #46: `Open login page [ER: Form shown/Logo visible]`, `beforeId` вставил шаг первым |
| `update_test_case_step` | читает сценарий (`testCaseId` обязателен); text-only → `PATCH ?withExpectedResult=<hasER> {body, expectedResultId}`; `expectedResult` → DELETE старых строк + POST новых; `""` → снять ER; работает и с ER-контейнером, и с отдельной строкой | ✅ правка текста сохранила ER; replace → `[ER: Only new ER]`; `""` → ER снят |
| `set_test_case_step_expected_result` | `body` берётся из сценария; append после последней строки | ✅ два вызова без `body` → `[ER: Dashboard opened/Toast shown]` |
| `delete_test_case_step` (новый) | `DELETE /api/testcase/step/{id}` | ✅ шаг удалён |
| `resolve_test_result` | без `execution` читает `GET /execution?v2=true` и отправляет обратно | ✅ TR #50: `failed`, `message` сохранён, шаги 7 → 7 |
| `update_test_result` | `status`/`message`/`trace`/`categoryId` уходят в resolve, остальное — merge-PATCH | ✅ TR #51: `broken`, шаги 7. Попутно выяснилось: PATCH меняет только `tags`/`links`, а `name`/`description` берутся из ТК (описание тула уточнено) |
| `bulk_close_defects` / `bulk_reopen_defects` | `{projectId, selection:{ids, inverted:false, kind:"ListSelectionDto", projectId}}`, top-level `ids` | ✅ закрыт → `closed:true`, открыт → `false` |
| `link_defect_to_test_results` | `{ids:[defectId], selection:{TreeSelectionDto, launchId, leafsInclude}}`, `launchId` обязателен | ✅ 4 результата launch 6 привязаны к дефекту 1 |
| `find_similar_failures` | `launchId` обязателен; `messageRegex`/`traceRegex`; regex из `GET /api/defect/{id}/matcher` по `defectId` | ✅ по матчеру `.*Timeout.*login.*` найден TR #13 |
| `set_test_case_issues` | проверка `integrationId` + read-back (ошибка, если сохранено 0) | unit ✅ (интеграции на стенде нет — поведение 200+`[]` зафиксировано в части 3) |
| `get_widget_data` | `dateFrom`/`dateTo` (`YYYY-MM-DD`), `offset` (часы); `from`/`to` конвертируются | ✅ (часть 5: `dateFrom`/`dateTo` дают точный диапазон) + unit |

## Описания (⚠️) → исправлено

- **Описания переписаны:**
  - аналитика: `get_automation_chart`, `get_statistic_trend`, `get_tc_success_rate` (`offset` в часах, ограничение −12..14);
  - тест-кейсы: `set_test_case_tags`, `set_test_case_custom_fields`, `set_test_case_step_expected_result`, `create_test_case`, `update_test_case`;
  - тест-планы и shared steps: `create_test_plan`, `update_test_plan`, `create_shared_step`;
  - дефекты: `create_defect`, `update_defect`, `link_issue_to_defect`;
  - релизы: `get_release_test_case_selection`, `create_release`;
  - дашборды: `create_dashboard`.
- **Поведение изменено:**
  - `get_release_test_case_tree`: по умолчанию `sort=id,asc`;
  - `copy_dashboard`: по умолчанию `preserveWidgetAql:true`.

## Справочник пользовательских путей как артефакт сервера

- **Источник:** `docs/usages/user-flows.md`.
- **Генерируемые копии** (`npm run docs:user-flows`; синхронность проверяет unit-тест):
  - `src/resources/docs/user-flows.ts`: попадает в `dist`, значит в npm-пакет и Docker-образ;
  - `skills/allure-testops/references/user-flows.md`.
- **MCP-ресурсы** (`text/markdown`, без обращений к API): `allure://guides/user-flows` и `allure://guides/aql`.
- **Ссылки на справочник:** из описаний ключевых тулов (`create_test_case`, `create_test_case_step`, `get_test_case_steps`, `resolve_test_result`, `create_test_plan`), из `SKILL.md` (правило 6) и из `docs/usages/examples/resources.md`.
