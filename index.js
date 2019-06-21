const md5 = require('md5');
const logger = require('simple-level-log/logger');

// const AWS = require('aws-sdk');
// AWS.config.update({ region: 'us-west-2' });
// const documentClient = new AWS.DynamoDB.DocumentClient();

/*
  Useful URLs
  https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html
  https://docs.amazonaws.cn/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#query-property
*/

module.exports.CacheManager = class CacheManager {
  constructor(
    documentClient,
    dynamoDBTableName,
    defaultTTLInSeconds = 60 * 15,
    downLoadCounter = true,
    redundancyCounter = true) {
    this.documentClient = documentClient;
    this.defaultTTLInSeconds = defaultTTLInSeconds;
    this.tableName = dynamoDBTableName;
    this.downLoadCounter = downLoadCounter;
    this.redundancyCounter = redundancyCounter;
  }


  /**
   * 
   * @param {*} key 
   * @param {*} recencyInSeconds 
   */
  async get(key, recencyInSeconds = null) {
    if (null != recencyInSeconds && 0 >= recencyInSeconds) {
      return null;
    }

    const keyMD5 = md5(key);
    const timeNowInMilliseconds = Date.now();
    const timeNowInSeconds = Math.floor(timeNowInMilliseconds / 1000);
    const recentTimeInMilliseconds = null == recencyInSeconds ? 0 : timeNowInMilliseconds - (recencyInSeconds * 1000);

    let dbItem = null;
    let params = null;

    try {
      params = {
        ProjectionExpression: 'cacheValue, ExpiryTime',
        TableName: this.tableName,
        KeyConditionExpression: 'KeyMD5 = :keyMD5',
        ExpressionAttributeValues: {
          ':keyMD5': keyMD5,
          ':timeNowInSeconds': timeNowInSeconds,
          ':recentTimeInMilliseconds': recentTimeInMilliseconds,
        },
        FilterExpression: 'ExpiryTime > :timeNowInSeconds and timeUpdated > :recentTimeInMilliseconds',
        Limit: 1
      };

      const dbRecord = await this.documentClient.query(params).promise();
      if (null == dbRecord || null == dbRecord.Items || 0 === dbRecord.Items.length) {
        return null;
      }

      // eslint-disable-next-line prefer-destructuring
      dbItem = dbRecord.Items[0];
    } catch (e) {
      logger.warn(`Error occurred while returning cacheValue of: (KeyMD5=${keyMD5}, cacheKey=${key}):`);
      logger.error(e);
      return null;
    }

    if (true === this.downLoadCounter) {
      //--- Increment download counter.
      try {
        params = {
          TableName: this.tableName,
          Key: {
            KeyMD5: keyMD5,
          },
          UpdateExpression: 'set downloads = downloads + :one',
          ExpressionAttributeValues: {
            ':one': 1,
          },
          ReturnValues: 'UPDATED_NEW',
        };

        const data = await this.documentClient.update(params).promise();
      } catch (e) {
        logger.error(e);
      }
    }

    return { value: JSON.parse(dbItem.cacheValue), ExpiryTime: dbItem.ExpiryTime };
  }


  /**
   * 
   * @param {*} key 
   * @param {*} value 
   * @param {*} ttlInSeconds 
   */
  async put(key, value, ttlInSeconds) {
    if (null == ttlInSeconds || 0 >= ttlInSeconds) {
      ttlInSeconds = this.defaultTTLInSeconds;
      logger.warn(`Updagraded ttlInSeconds value to ${this.defaultTTLInSeconds} seconds.`);
    }

    if (null == value) {
      logger.warn(`${key} is not cached as value associated it is null.`);
      return null;
    }

    const valueToCache = logger.stringify(value);
    const keyMD5 = md5(key);
    const valueMD5 = md5(valueToCache);
    let timeNowInMilliseconds = Date.now();
    let timeNowInSeconds = Math.floor(timeNowInMilliseconds / 1000);

    let params = null;

    try {
      params = {
        ProjectionExpression: 'ValueMD5, ttlInSeconds, ExpiryTime',
        TableName: this.tableName,
        KeyConditionExpression: 'KeyMD5 = :keyMD5',
        ExpressionAttributeValues: {
          ':keyMD5': keyMD5,
          ':timeNowInSeconds': timeNowInSeconds,
          ':valueMD5': valueMD5,
        },
        FilterExpression: 'ExpiryTime > :timeNowInSeconds and ValueMD5 = :valueMD5',
        Limit: 1
      };

      const dbRecord = await documentClient.query(params).promise();
      if (null != dbRecord && null != dbRecord.Items && 0 !== dbRecord.Items.length) {
        const dbItem = dbRecord.Items[0];

        if (true !== this.redundancyCounter) {
          return { keyMD5, ExpiryTime: dbItem.ExpiryTime };
        }

        // Increment redundancy, timeUpdated and ExpiryTime
        params = {
          TableName: this.tableName,
          Key: {
            KeyMD5: keyMD5,
          },
          UpdateExpression: 'set redundancy = redundancy + :one, timeUpdated = :timeNowInSeconds, ExpiryTime = :ExpiryTime',
          ExpressionAttributeValues: {
            ':one': 1,
            ':timeNowInSeconds': timeNowInSeconds,
            ':ExpiryTime': timeNowInSeconds + dbItem.ttlInSeconds,
          },
          ReturnValues: 'UPDATED_NEW',
        };

        const data = await documentClient.update(params).promise();
        return { keyMD5, ExpiryTime: data.Attributes.ExpiryTime };
      }
    } catch (e) {
      logger.error(e);
      return null;
    }

    try {
      let timeNowInMilliseconds = Date.now();
      let timeNowInSeconds = Math.floor(timeNowInMilliseconds / 1000);
      params = {
        TableName: this.tableName,
        Item: {
          KeyMD5: keyMD5,
          cacheKey: key,
          cacheValue: valueToCache,
          ValueMD5: valueMD5,
          downloads: 0,
          redundancy: 0,
          timeCreated: timeNowInMilliseconds,
          timeUpdated: timeNowInMilliseconds,
          ttlInSeconds,
          ExpiryTime: timeNowInSeconds + ttlInSeconds,
        },
      };
      await documentClient.put(params).promise();
      return { keyMD5, ExpiryTime: params.Item.ExpiryTime };
    } catch (e) {
      logger.error(e);
    }
    return null;
  }


  async delete(key) {
    if (null != recencyInSeconds && 0 >= recencyInSeconds) {
      return null;
    }

    const keyMD5 = md5(key);

    try {
      params = {
        TableName: this.tableName,
        Key: {
          KeyMD5: keyMD5,
        }
      };
      const dbRecord = await this.documentClient.delete(params).promise();
      return true;
    } catch (e) {
      logger.error(e);
    }

    return false;
  }
};
