# Dashboard Recovery History System

## Overview

The Dashboard Recovery History system provides comprehensive monitoring and logging of all recovery actions performed by the SeedGPT autonomous agent. This system ensures transparency, debugging capabilities, and historical tracking of system behavior.

## Key Features

### 1. **Real-time Recovery Logging**
- All recovery actions are logged with timestamps
- Actions include branch recovery, task recovery, and system resets
- Logs are persistent and accessible through the dashboard

### 2. **Dashboard Integration**
- Recovery history is accessible via the `/api/recovery-history` endpoint
- User-friendly formatting with readable timestamps
- Configurable result limits for performance optimization

### 3. **Recovery Action Types**
- **NUKE_BRANCH**: Complete branch cleanup and reset
- **CONVERTED_TO_RESEARCH**: Failed task converted to research type
- **RESET_STALE_TASK**: Task reset after extended inactivity
- **EMERGENCY_RESET**: System-wide recovery operation

## Architecture

### Components

#### BranchRecoveryManager
Located in `src/branchRecoveryManager.ts`, this class handles:

```typescript
class BranchRecoveryManager {
    // Core recovery operations
    async nukeBranchIfStuck(task: Task, branchName: string): Promise<boolean>
    async performEmergencyReset(): Promise<void>
    async attemptTaskRecovery(task: Task): Promise<boolean>
    
    // History management
    async getRecoveryHistory(limit: number = 10): Promise<string[]>
    private async logRecoveryAction(task: Task | null, target: string, action: string): Promise<void>
}
```

#### DashboardManager Integration
The dashboard provides HTTP API access to recovery history:

```typescript
// GET /api/recovery-history?limit=20
{
    "entries": [
        {
            "timestamp": "2024-01-15T10:30:00.000Z",
            "action": "Task #15: NUKE_BRANCH on feature/task-15",
            "formatted": "1/15/2024, 10:30:00 AM"
        }
    ],
    "total": 1
}
```

### Recovery Triggers

#### 1. **Branch Nuke Conditions**
- Task has failed multiple times (>3 failures)
- Branch has been stuck for extended period (>24 hours)
- Multiple consecutive errors in same branch
- Manual emergency recovery trigger

#### 2. **Task Recovery Conditions**
- Task failure count exceeds threshold (≥3 failures)
- Task has been stale for over 48 hours
- Task is in blocked state with recoverable conditions

#### 3. **Emergency Reset Conditions**
- System-wide failures across multiple components
- Git repository corruption or conflicts
- Manual administrator intervention

## Usage

### Dashboard Access
1. Navigate to the dashboard web interface
2. Authenticate using configured credentials
3. Access recovery history via the API or dashboard UI
4. Filter results by date range or action type

### API Integration
```typescript
// Fetch recent recovery history
const response = await fetch('/api/recovery-history?limit=50', {
    headers: {
        'Authorization': `Bearer ${authToken}`
    }
})

const recoveryData = await response.json()
```

### Configuration
Recovery behavior is configured via `agent-config.yaml`:

```yaml
recovery:
  maxFailureCount: 3
  staleTaskThreshold: 48h
  branchStuckThreshold: 24h
  emergencyResetEnabled: true
```

## Recovery Log Format

### Log Entry Structure
```
2024-01-15T10:30:00.000Z - Task #15: NUKE_BRANCH on feature/task-15
2024-01-15T11:45:00.000Z - Task #23: CONVERTED_TO_RESEARCH
2024-01-15T14:20:00.000Z - System: EMERGENCY_RESET on main branch
```

### Components
- **Timestamp**: ISO 8601 formatted timestamp
- **Source**: Task ID or "System" for system-wide actions
- **Action**: Type of recovery action performed
- **Target**: Branch, task, or system component affected

## Security & Authentication

### Dashboard Protection
- All dashboard endpoints require authentication
- Uses bcrypt-hashed password protection
- Bearer token authentication for API access

### Environment Variables
```bash
DASHBOARD_PASSWORD_HASH=$2b$10$N9qo8uLOickgx2ZMRZoMye.jtFTGe/7VEn8nDFCUKmJjF8C2b3Kyu
```

### Access Control
- Health endpoint (`/health`) is publicly accessible
- All other endpoints require valid authentication
- Recovery history contains sensitive operational data

## Monitoring & Alerting

### Key Metrics
- Recovery action frequency
- Most common recovery types
- Task failure patterns
- System stability indicators

### Dashboard Insights
- Real-time recovery status
- Historical trend analysis
- System health correlation
- Performance impact assessment

## Troubleshooting

### Common Issues

#### 1. **Missing Recovery History**
- Check if `recovery.log` file exists in workspace
- Verify BranchRecoveryManager initialization
- Ensure proper file permissions

#### 2. **Authentication Failures**
- Verify `DASHBOARD_PASSWORD_HASH` environment variable
- Check bcrypt hash generation
- Validate Bearer token format

#### 3. **API Errors**
- Monitor dashboard logs for detailed error messages
- Check task manager integration
- Verify recovery manager initialization

### Debug Commands
```bash
# Check recovery log
cat recovery.log

# Verify dashboard configuration
npm run dashboard -- --debug

# Test authentication
curl -H "Authorization: Bearer password" http://localhost:3000/api/recovery-history
```

## Future Enhancements

### Planned Features
1. **Recovery Analytics**: Statistical analysis of recovery patterns
2. **Alert Integration**: Real-time notifications for critical recoveries
3. **Recovery Automation**: Smart recovery strategy selection
4. **Performance Metrics**: Impact analysis of recovery actions
5. **Export Capabilities**: CSV/JSON export of recovery history

### Integration Opportunities
- Integration with external monitoring systems
- Slack/Teams notifications for critical recoveries
- GitHub issue creation for repeated failures
- Automated incident response workflows

## Conclusion

The Dashboard Recovery History system provides essential visibility into the SeedGPT agent's autonomous recovery capabilities. By maintaining comprehensive logs and providing accessible interfaces, it enables effective monitoring, debugging, and optimization of the system's reliability and performance.

This system is a critical component for maintaining trust and transparency in autonomous AI development workflows, ensuring that all recovery actions are properly documented and accessible for review.
