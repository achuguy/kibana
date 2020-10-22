/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import { ClusterHealthAlert } from './cluster_health_alert';
import { ALERT_CLUSTER_HEALTH } from '../../common/constants';
import { fetchLegacyAlerts } from '../lib/alerts/fetch_legacy_alerts';
import { fetchClusters } from '../lib/alerts/fetch_clusters';

const RealDate = Date;

jest.mock('../lib/alerts/fetch_legacy_alerts', () => ({
  fetchLegacyAlerts: jest.fn(),
}));
jest.mock('../lib/alerts/fetch_clusters', () => ({
  fetchClusters: jest.fn(),
}));

describe('ClusterHealthAlert', () => {
  it('should have defaults', () => {
    const alert = new ClusterHealthAlert();
    expect(alert.type).toBe(ALERT_CLUSTER_HEALTH);
    expect(alert.label).toBe('Cluster health');
    expect(alert.defaultThrottle).toBe('1d');
    // @ts-ignore
    expect(alert.actionVariables).toStrictEqual([
      { name: 'clusterHealth', description: 'The health of the cluster.' },
      {
        name: 'internalShortMessage',
        description: 'The short internal message generated by Elastic.',
      },
      {
        name: 'internalFullMessage',
        description: 'The full internal message generated by Elastic.',
      },
      { name: 'state', description: 'The current state of the alert.' },
      { name: 'clusterName', description: 'The cluster to which the nodes belong.' },
      { name: 'action', description: 'The recommended action for this alert.' },
      {
        name: 'actionPlain',
        description: 'The recommended action for this alert, without any markdown.',
      },
    ]);
  });

  describe('execute', () => {
    function FakeDate() {}
    FakeDate.prototype.valueOf = () => 1;

    const clusterUuid = 'abc123';
    const clusterName = 'testCluster';
    const legacyAlert = {
      prefix: 'Elasticsearch cluster status is yellow.',
      message: 'Allocate missing replica shards.',
      metadata: {
        severity: 2000,
        cluster_uuid: clusterUuid,
      },
    };
    const getUiSettingsService = () => ({
      asScopedToClient: jest.fn(),
    });
    const getLogger = () => ({
      debug: jest.fn(),
    });
    const monitoringCluster = null;
    const config = {
      ui: {
        ccs: { enabled: true },
        container: { elasticsearch: { enabled: false } },
        metricbeat: { index: 'metricbeat-*' },
      },
    };
    const kibanaUrl = 'http://localhost:5601';

    const replaceState = jest.fn();
    const scheduleActions = jest.fn();
    const getState = jest.fn();
    const executorOptions = {
      services: {
        callCluster: jest.fn(),
        alertInstanceFactory: jest.fn().mockImplementation(() => {
          return {
            replaceState,
            scheduleActions,
            getState,
          };
        }),
      },
      state: {},
    };

    beforeEach(() => {
      // @ts-ignore
      Date = FakeDate;
      (fetchLegacyAlerts as jest.Mock).mockImplementation(() => {
        return [legacyAlert];
      });
      (fetchClusters as jest.Mock).mockImplementation(() => {
        return [{ clusterUuid, clusterName }];
      });
    });

    afterEach(() => {
      Date = RealDate;
      replaceState.mockReset();
      scheduleActions.mockReset();
      getState.mockReset();
    });

    it('should fire actions', async () => {
      const alert = new ClusterHealthAlert();
      alert.initializeAlertType(
        getUiSettingsService as any,
        monitoringCluster as any,
        getLogger as any,
        config as any,
        kibanaUrl,
        false
      );
      const type = alert.getAlertType();
      await type.executor({
        ...executorOptions,
        // @ts-ignore
        params: alert.defaultParams,
      } as any);
      expect(replaceState).toHaveBeenCalledWith({
        alertStates: [
          {
            cluster: { clusterUuid: 'abc123', clusterName: 'testCluster' },
            ccs: undefined,
            ui: {
              isFiring: true,
              message: {
                text: 'Elasticsearch cluster health is yellow.',
                nextSteps: [
                  {
                    text: 'Allocate missing replica shards. #start_linkView now#end_link',
                    tokens: [
                      {
                        startToken: '#start_link',
                        endToken: '#end_link',
                        type: 'link',
                        url: 'elasticsearch/indices',
                      },
                    ],
                  },
                ],
              },
              severity: 'danger',
              resolvedMS: 0,
              triggeredMS: 1,
              lastCheckedMS: 0,
            },
          },
        ],
      });
      expect(scheduleActions).toHaveBeenCalledWith('default', {
        action: '[Allocate missing replica shards.](elasticsearch/indices)',
        actionPlain: 'Allocate missing replica shards.',
        internalFullMessage:
          'Cluster health alert is firing for testCluster. Current health is yellow. [Allocate missing replica shards.](elasticsearch/indices)',
        internalShortMessage:
          'Cluster health alert is firing for testCluster. Current health is yellow. Allocate missing replica shards.',
        clusterName,
        clusterHealth: 'yellow',
        state: 'firing',
      });
    });

    it('should not fire actions if there is no legacy alert', async () => {
      (fetchLegacyAlerts as jest.Mock).mockImplementation(() => {
        return [];
      });
      const alert = new ClusterHealthAlert();
      alert.initializeAlertType(
        getUiSettingsService as any,
        monitoringCluster as any,
        getLogger as any,
        config as any,
        kibanaUrl,
        false
      );
      const type = alert.getAlertType();
      await type.executor({
        ...executorOptions,
        // @ts-ignore
        params: alert.defaultParams,
      } as any);
      expect(replaceState).not.toHaveBeenCalledWith({});
      expect(scheduleActions).not.toHaveBeenCalled();
    });

    it('should resolve with a resolved message', async () => {
      (fetchLegacyAlerts as jest.Mock).mockImplementation(() => {
        return [
          {
            ...legacyAlert,
            resolved_timestamp: 1,
          },
        ];
      });
      (getState as jest.Mock).mockImplementation(() => {
        return {
          alertStates: [
            {
              cluster: {
                clusterUuid,
                clusterName,
              },
              ccs: undefined,
              ui: {
                isFiring: true,
                message: null,
                severity: 'danger',
                resolvedMS: 0,
                triggeredMS: 1,
                lastCheckedMS: 0,
              },
            },
          ],
        };
      });
      const alert = new ClusterHealthAlert();
      alert.initializeAlertType(
        getUiSettingsService as any,
        monitoringCluster as any,
        getLogger as any,
        config as any,
        kibanaUrl,
        false
      );
      const type = alert.getAlertType();
      await type.executor({
        ...executorOptions,
        // @ts-ignore
        params: alert.defaultParams,
      } as any);
      expect(replaceState).toHaveBeenCalledWith({
        alertStates: [
          {
            cluster: { clusterUuid, clusterName },
            ccs: undefined,
            ui: {
              isFiring: false,
              message: {
                text: 'Elasticsearch cluster health is green.',
              },
              severity: 'danger',
              resolvedMS: 1,
              triggeredMS: 1,
              lastCheckedMS: 0,
            },
          },
        ],
      });
      expect(scheduleActions).toHaveBeenCalledWith('default', {
        internalFullMessage: 'Cluster health alert is resolved for testCluster.',
        internalShortMessage: 'Cluster health alert is resolved for testCluster.',
        clusterName,
        clusterHealth: 'yellow',
        state: 'resolved',
      });
    });
  });
});
