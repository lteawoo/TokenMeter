## ADDED Requirements

### Requirement: TokenMeter SHALL run as a desktop application
The system SHALL provide a Tauri-based desktop application that launches the TokenMeter dashboard UI in a native window on local development machines.

#### Scenario: Desktop app starts successfully
- **WHEN** a developer launches the Tauri desktop app
- **THEN** the TokenMeter dashboard UI MUST render in a native application window

#### Scenario: Desktop app uses the existing dashboard interface
- **WHEN** the desktop app loads
- **THEN** it MUST present the same core dashboard views for overview and sessions as the supported web experience

### Requirement: Desktop builds SHALL not require the Node web server for Codex overview data
The system SHALL allow the desktop application to load Codex overview data without starting the existing Node server in `apps/server`.

#### Scenario: Desktop overview loads from native backend
- **WHEN** the desktop dashboard requests Codex overview data
- **THEN** the data MUST be returned through a Tauri-native backend path instead of the web HTTP API

#### Scenario: Desktop app runs without web server
- **WHEN** the desktop app is launched while the Node web server is not running
- **THEN** the desktop dashboard MUST still be able to load its Codex overview data

### Requirement: Dashboard data access SHALL support both web and desktop environments
The system SHALL separate dashboard data loading from UI rendering so the same frontend can operate against a web data source or a desktop-native data source.

#### Scenario: Web dashboard uses web data source
- **WHEN** TokenMeter runs in the browser development workflow
- **THEN** the dashboard MUST continue to load overview data from the existing web API path

#### Scenario: Desktop dashboard uses desktop data source
- **WHEN** TokenMeter runs inside Tauri
- **THEN** the dashboard MUST load overview data through the desktop-native data source without requiring UI-specific forks

### Requirement: Desktop overview responses SHALL preserve the dashboard contract
The system SHALL return desktop overview data in a shape that preserves the frontend contract required by the current dashboard summaries, charts, and session ledger.

#### Scenario: Desktop overview contains summary fields
- **WHEN** the frontend receives overview data from the desktop-native path
- **THEN** it MUST include the summary and session fields required to render the existing dashboard cards and tables

#### Scenario: Desktop overview handles missing Codex session data
- **WHEN** no readable Codex session data is present on the local machine
- **THEN** the desktop-native path MUST return an empty or no-data result that the dashboard can render without crashing
