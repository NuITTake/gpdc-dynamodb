# gpdc-dynamodb

This super lightweight and easy to use package provides a **G**eneral-**P**urpose **D**urable **C**ashing solution based on key-value storage. For persistent store it uses [DynamoDB](https://aws.amazon.com/dynamodb/) that way consumers can take full advantage of DynamoDB. 

**Typical use cases:** 
- RDBMS data reporting 
- Middle Layer data caching 
- Web-Client caching
- Web-Server caching

_This solution is not not recommended for applications with cache busting need under a few seconds._

### Prerequisites

1. Create a DynamoDB table called GeneralPurposeDurableCache (or you can use any valid table name that you like) with **Primary key (Partition key): KeyMD5 of String type**. 

2. Add **ExpiryTime** as a TTL attribute

3. Make sure to monitor and adjust table's read and write capacity as per your application's need.

4. Make sure to grant necessary access permissions to your code (in which you are planning to use this package) to access your DynamoDB table. This package needs the following permission:
  - delete item
  - query item
  - put items

### Installing

```
npm i gpdc-dynamodb
```
### Table attributes:

1. **KeyMD5** [String] User created.
2. ValueMD5 [String] Auto created.
3. cacheKey [String] Auto created.
4. cacheValue [String] Auto created.
5. ttlInSeconds [Number] Auto created.
6. **ExpiryTime** [Number] Auto created.  
  - Use this as a TTL attribute.
  - Value is in seconds.
7. timeCreated [Number] Auto created.
  - Value in in milliseconds
8. timeUpdated [Number] Auto created.
  - Value in in milliseconds
9. downloads [Number] Auto created.
  - This accounting counter indicates how many time a cached value has been served. 
  - While creating an instance of **CacheManager**, if you set value **downLoadCounter** to **false** then this attribute will not be updated. 
10. redundancy [Number] Auto created.
  - This accounting counter indicates how many time an exact same value was attempted to put into cache.
  - While creating an instance of **CacheManager**, if you set value **redundancyCounter** to **false** then this attribute along with **timeUpdated** and **ExpiryTime** will not be updated.

*Switching accouting counters off will save one write operation in each of **get** and **put** call. However it not recommended as the entire operation of data access takes extreamly small amount off time (in most of the situation it should not take more than couple of milliseconds).*



### Example: How to use GPDC with and without accounting counters

```
'use strict';

const AWS = require('aws-sdk');
const { CacheManager } = require('gpdc-dynamodb');
const logger = require('simple-level-log/logger');

AWS.config.update({ region: 'us-west-1' });
const documentClient = new AWS.DynamoDB.DocumentClient();
const dynamoDBTableName = 'GeneralPurposeDurableCache';

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function test(downLoadCounter = true, redundancyCounter = true) {

  try {

    logger.debug(`BEGIN: main(downLoadCounter = ${downLoadCounter}, redundancyCounter = ${redundancyCounter})`);

    const cacheManager = new CacheManager(documentClient, dynamoDBTableName, downLoadCounter, redundancyCounter);

    const key = 'my-number-list';

    //--- Deleting a key just restore the base state for the sake of this example, so that rest of code will work as expected. 
    await cacheManager.delete(key);

    //--- Cache data for 60 seconds
    let ttlInSeconds = 60 * 1;
    let value = [102, 9123, 1233, 1992, 162, 1923, 232312, 10031212];

    let results = await cacheManager.put(key, value, ttlInSeconds);
    if (null == results) {
      logger.warn(`Aborting as CacheManager failed to cache ${key}.`);
      return;
    }
    logger.info(`Cached [${key}] till ${(new Date(results.ExpiryTime * 1000)).toUTCString()}.`);


    //--- Get cached value, without worrying about recency
    results = await cacheManager.get(key);
    if (null == results) {
      logger.info(`[${key}] does not exists in cache.`);
    } else {
      logger.info(`[${key}]: ${JSON.stringify(results.value)}. Valid till ${(new Date(results.ExpiryTime * 1000)).toUTCString()}.`);
    }


    //--- Get cached value, only if it has been created/updated with the last 10 seconds. 
    let recencyInSeconds = 10;
    results = await cacheManager.get(key, recencyInSeconds);
    if (null == results) {
      logger.warn(`${recencyInSeconds} seconds recent cache for [${key}] does not exists.`);
    } else {
      logger.info(`[${key}]: ${JSON.stringify(results.value)}. Valid till ${(new Date(results.ExpiryTime * 1000)).toUTCString()}.`);
    }


    //--- Sleep for 15 seconds and then get a cached value, only if it has been created/updated 10 second before
    await sleep(1000 * 15);
    results = await cacheManager.get(key, recencyInSeconds);
    if (null == results) {
      logger.warn(`${recencyInSeconds} seconds recent cache for [${key}] does not exists.`);
    } else {
      logger.info(`[${key}]: ${JSON.stringify(results.value)}. Valid till ${(new Date(results.ExpiryTime * 1000)).toUTCString()}.`);
    }

    //--- Try to cache the exact same value for the exact same key
    results = await cacheManager.put(key, value, ttlInSeconds);
    if (null == results) {
      logger.warn(`Aborting as CacheManager failed to cache ${key}.`);
      return;
    }
    logger.info(`Cached [${key}] till ${(new Date(results.ExpiryTime * 1000)).toUTCString()}.`);

  } finally {
    logger.debug(`END: main(downLoadCounter = ${downLoadCounter}, redundancyCounter = ${redundancyCounter})`);
  }
}

async function main() {
  console.log('===============================================================================');
  await test(true, true);
  console.log('-------------------------------------------------------------------------------');
  await test(false, false); // Please take a note of the fact that ExpiryTime during second update did not change.
  console.log('===============================================================================');
}

main(true, true)
  .then(logger.log)
  .catch(logger.error);



Output:
===============================================================================
[D]: BEGIN: main(downLoadCounter = true, redundancyCounter = true)
[I]: Cached [my-number-list] till Sun, 23 Jun 2019 07:39:02 GMT.
[I]: [my-number-list]: [102,9123,1233,1992,162,1923,232312,10031212]. Valid till Sun, 23 Jun 2019 07:39:02 GMT.
[I]: [my-number-list]: [102,9123,1233,1992,162,1923,232312,10031212]. Valid till Sun, 23 Jun 2019 07:39:02 GMT.
[W]: 10 seconds recent cache for [my-number-list] does not exists.
[I]: Cached [my-number-list] till Sun, 23 Jun 2019 07:39:18 GMT.
[D]: END: main(downLoadCounter = true, redundancyCounter = true)
-------------------------------------------------------------------------------
[D]: BEGIN: main(downLoadCounter = false, redundancyCounter = false)
[I]: Cached [my-number-list] till Sun, 23 Jun 2019 07:39:18 GMT.
[I]: [my-number-list]: [102,9123,1233,1992,162,1923,232312,10031212]. Valid till Sun, 23 Jun 2019 07:39:18 GMT.
[I]: [my-number-list]: [102,9123,1233,1992,162,1923,232312,10031212]. Valid till Sun, 23 Jun 2019 07:39:18 GMT.
[W]: 10 seconds recent cache for [my-number-list] does not exists.
[I]: Cached [my-number-list] till Sun, 23 Jun 2019 07:39:18 GMT. 
[D]: END: main(downLoadCounter = false, redundancyCounter = false)
===============================================================================
```


## Bugs and Issues

If you encounter any bugs or issues, feel free to open an issue at
[github](https://github.com/NuITTake/simple-level-log/issues).


## Contributing

Please email to NuITTake@GMail.Com if you wish to extend a helping hand. 

## Authors

* **Nu IT Take** - NuITTake@GMail.Com

## This project is licensed under the [ISC License (ISC)](https://opensource.org/licenses/ISC)

Copyright 2019 Nu IT Take (NuITTake@GMail.Com)

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.