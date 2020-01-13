/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { FtrProviderContext } from '../../ftr_provider_context';

export default ({ getPageObjects, getService }: FtrProviderContext) => {
  const pageObjects = getPageObjects(['common', 'endpoint']);
  const testSubjects = getService('testSubjects');

  describe('Alerts List Page', function() {
    this.tags(['skipCloud']);
    before(async () => {
      await pageObjects.common.navigateToApp('endpoint');
    });

    it('Navigate to Alerts list page', async () => {
      // navigate to the alerts list page
      const container = await testSubjects.find('menuEndpoint');
      const link = await container.findByXpath("//button[. = 'Alerts']");
      await link.click();

      await testSubjects.existOrFail('tableHeaderCell_endgame.timestamp_utc.keyword_0');
    });
  });
};
