/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import expect from '@kbn/expect';

import { FtrProviderContext } from '../../ftr_provider_context';
import { setupIngest, getSupertestWithoutAuth } from './agents/services';

export default function (providerContext: FtrProviderContext) {
  const { getService } = providerContext;
  const esArchiver = getService('esArchiver');
  const supertest = getService('supertest');
  const supertestWithoutAuth = getSupertestWithoutAuth(providerContext);
  const esClient = getService('es');

  describe('fleet_agent_flow', () => {
    before(async () => {
      await esArchiver.load('empty_kibana');
    });
    setupIngest(providerContext);
    after(async () => {
      await esArchiver.unload('empty_kibana');
    });

    it('should work', async () => {
      // 1. Get enrollment token
      const { body: enrollmentApiKeysResponse } = await supertest
        .get(`/api/ingest_manager/fleet/enrollment-api-keys`)
        .expect(200);

      expect(enrollmentApiKeysResponse.list).length(1);
      const { body: enrollmentApiKeyResponse } = await supertest
        .get(
          `/api/ingest_manager/fleet/enrollment-api-keys/${enrollmentApiKeysResponse.list[0].id}`
        )
        .expect(200);

      expect(enrollmentApiKeyResponse.item).to.have.key('api_key');
      const enrollmentAPIToken = enrollmentApiKeyResponse.item.api_key;
      // 2. Enroll agent
      const { body: enrollmentResponse } = await supertestWithoutAuth
        .post(`/api/ingest_manager/fleet/agents/enroll`)
        .set('kbn-xsrf', 'xxx')
        .set('Authorization', `ApiKey ${enrollmentAPIToken}`)
        .send({
          type: 'PERMANENT',
          metadata: {
            local: {},
            user_provided: {},
          },
        })
        .expect(200);
      expect(enrollmentResponse.success).to.eql(true);

      const agentAccessAPIKey = enrollmentResponse.item.access_api_key;

      // 3. agent checkin
      const { body: checkinApiResponse } = await supertestWithoutAuth
        .post(`/api/ingest_manager/fleet/agents/${enrollmentResponse.item.id}/checkin`)
        .set('kbn-xsrf', 'xx')
        .set('Authorization', `ApiKey ${agentAccessAPIKey}`)
        .send({
          events: [],
        })
        .expect(200);

      expect(checkinApiResponse.success).to.eql(true);
      expect(checkinApiResponse.actions).length(1);
      expect(checkinApiResponse.actions[0].type).be('CONFIG_CHANGE');
      const configChangeAction = checkinApiResponse.actions[0];
      const defaultOutputApiKey = configChangeAction.data.config.outputs.default.api_key;

      // 4. ack actions
      const { body: ackApiResponse } = await supertestWithoutAuth
        .post(`/api/ingest_manager/fleet/agents/${enrollmentResponse.item.id}/acks`)
        .set('Authorization', `ApiKey ${agentAccessAPIKey}`)
        .set('kbn-xsrf', 'xx')

        .send({
          events: [
            {
              type: 'ACTION_RESULT',
              subtype: 'CONFIG',
              timestamp: '2019-01-04T14:32:03.36764-05:00',
              action_id: configChangeAction.id,
              agent_id: enrollmentResponse.item.id,
              message: 'hello',
              payload: 'payload',
            },
          ],
        })
        .expect(200);
      expect(ackApiResponse.success).to.eql(true);

      // 4. second agent checkin
      const { body: secondCheckinApiResponse } = await supertestWithoutAuth
        .post(`/api/ingest_manager/fleet/agents/${enrollmentResponse.item.id}/checkin`)
        .set('kbn-xsrf', 'xx')
        .set('Authorization', `ApiKey ${agentAccessAPIKey}`)
        .send({
          events: [],
        })
        .expect(200);
      expect(secondCheckinApiResponse.success).to.eql(true);
      expect(secondCheckinApiResponse.actions).length(0);

      // 5. unenroll agent
      const { body: unenrollResponse } = await supertest
        .post(`/api/ingest_manager/fleet/agents/${enrollmentResponse.item.id}/unenroll`)
        .set('kbn-xsrf', 'xx')
        .expect(200);
      expect(unenrollResponse.success).to.eql(true);

      // 6. Checkin after unenrollment
      await supertestWithoutAuth
        .post(`/api/ingest_manager/fleet/agents/${enrollmentResponse.item.id}/checkin`)
        .set('kbn-xsrf', 'xx')
        .set('Authorization', `ApiKey ${agentAccessAPIKey}`)
        .send({
          events: [],
        })
        .expect(401);

      // very api key are invalidated
      const {
        body: { api_keys: accessAPIKeys },
      } = await esClient.security.getApiKey({
        id: Buffer.from(agentAccessAPIKey, 'base64').toString('utf8').split(':')[0],
      });
      expect(accessAPIKeys).length(1);
      expect(accessAPIKeys[0].invalidated).eql(true);

      const {
        body: { api_keys: outputAPIKeys },
      } = await esClient.security.getApiKey({
        id: defaultOutputApiKey.split(':')[0],
      });
      expect(outputAPIKeys).length(1);
      expect(outputAPIKeys[0].invalidated).eql(true);
    });
  });
}
