// Add a compatibility layer for browser vendors.
if (typeof browser === "undefined" && typeof chrome !== "undefined") {
    var browser = chrome;
} else if (typeof browser === "undefined" && typeof chrome === "undefined") {
    console.error('Neither browser nor chrome API is available');
    // Fallback for environments where neither API is available
    var browser = {
        storage: {
            local: {
                get: () => Promise.resolve({}),
                set: () => Promise.resolve()
            }
        },
        tabs: {
            create: () => {}
        }
    };
}

$(() => {
    const supportEmail = 'support@z-lib.do'
    const domains = {
        staticList: [
            'https://z-library.sk',
            'https://z-lib.gd',
            'https://z-lib.fm',
            'https://z-lib.gd',
            'https://z-lib.by'
        ],
        getLastAvailableDomain: () => {
            return browser.storage.local.get(['availableDomain']).then(result => result.availableDomain);
        },
        getAll: async () => {
            try {
                const result = await browser.storage.local.get(['allDomains']);
                const list = result.allDomains ? JSON.parse(result.allDomains) : [];
                if (Array.isArray(list) && list.length) {
                    for (let domain of domains.staticList) {
                        if (list.indexOf(domain) === -1) {
                            list.push(domain)
                        }
                    }
                    return list
                }
            } catch (error) {}

            return Array.from(domains.staticList)
        },
        updateList: async (availableDomain, callback) => {
            try {
                const currentTimestamp = Math.ceil((new Date().getTime() / 1000))
                const result = await browser.storage.local.get(['lastUpdate']);
                const lastUpdate = parseInt(result.lastUpdate);
                
                if (isNaN(lastUpdate) || (currentTimestamp - lastUpdate) > 86400) {
                    await browser.storage.local.set({ lastUpdate: currentTimestamp.toString() });
                } else {
                    console.log('Domain list not updated, still valid.');
                    return callback();
                }
            } catch (error) {
                console.error('Error checking lastUpdate:', error);
                callback(); // Ensure callback is called even on error
                return;
            }

            // update domains
            const url = availableDomain + '/eapi/info/domains';
            console.log('Attempting to update domains from:', url);
            $.ajax({
                url: url,
                timeout: 7000,
            }).done(async (result) => {
                console.log('Domain update successful, result:', result);
                let list = Array.from(domains.staticList);
                if (result !== null && typeof result === 'object' && result.domains) {
                    for (let row of result.domains) {
                        if (row !== null && typeof row === 'object' && row.domain) {
                            list.push('https://' + row.domain);
                        }
                    }
                }
                list = list.filter(function(itm, i, a) {
                    return i === list.indexOf(itm);
                });
                await browser.storage.local.set({ allDomains: JSON.stringify(list) });
                callback();
            }).fail((jqXHR, textStatus, errorThrown)=> {
                console.error('Domain update failed:', textStatus, errorThrown);
                callback();
            });
        }
    }

    const domainsChecker = {
        stop: false,
        checkDomainTimeout: 15, // sec
        checkInParts: 5,
        checkInPartsDelay: 7, // sec
        processes: {
            list: {},
            add: (domain) => {
                domainsChecker.processes.list[domain] = 'start';
                console.log('Added domain to process list:', domain);
            },
            setAsCompleted: (domain) => {
                if (domainsChecker.processes.list[domain]) {
                    domainsChecker.processes.list[domain] = 'completed';
                    console.log('Marked domain as completed:', domain);
                }
            },
            clear: () => {
                domainsChecker.processes.list = {};
                console.log('Cleared domain processes.');
            },
            isEmpty: () => {
                for (let i in domainsChecker.processes.list) {
                    if (domainsChecker.processes.list[i] === 'start') {
                        return false;
                    }
                }
                return true;
            }
        },
        results: {
            availableDomain: null,
        },
        run: async (sendResponse) => {
            if (domainsChecker.stop) {
                console.log('Domain checker stopped.');
                return;
            }

            // fill processes
            domainsChecker.processes.clear();
            let domainsOriginal = await domains.getAll();
            if (!domainsOriginal || domainsOriginal.length === 0) {
                console.warn('No domains found in staticList or storage. Displaying no available domains message.');
                sendResponse({ availableDomain: null });
                return;
            }

            for (let domain of domainsOriginal) {
                domainsChecker.processes.add(domain);
            }

            // slice domains and create queue
            let domainsPart;
            let counter = 0;
            while (domainsPart = domainsOriginal.splice(0, domainsChecker.checkInParts)) {
                if (!domainsPart.length) {
                    break;
                }
                setTimeout((list) => {
                    for (let domain of list) {
                        domainsChecker.checkDomain(domain, (isAvailable) => {
                            if (domainsChecker.stop) {
                                console.log('Domain checker stopped during check.');
                                return;
                            }
                            if (!isAvailable) {
                                console.log('Domain not available:', domain);
                            }
                            domainsChecker.processes.setAsCompleted(domain);

                            if (domainsChecker.processes.isEmpty()) {
                                console.log('All domain checks completed. Sending response.');
                                return sendResponse(domainsChecker.results);
                            }
                            if (isAvailable && !domainsChecker.results.availableDomain) {
                                domainsChecker.stop = true;
                                domainsChecker.results.availableDomain = domain;
                                console.log('Found available domain:', domain, 'Stopping further checks.');
                                return sendResponse(domainsChecker.results);
                            }
                        });
                    }
                }, counter * domainsChecker.checkInPartsDelay * 1000, Array.from(domainsPart));
                counter += 1;
            }
            // If all checks complete and no domain is found, ensure sendResponse is called
            if (domainsChecker.processes.isEmpty() && !domainsChecker.results.availableDomain) {
                console.log('No available domains found after all checks.');
                sendResponse({ availableDomain: null });
            }
        },
        checkDomain: (domain, callback) => {
            if (domainsChecker.stop) {
                console.log('Check domain stopped for:', domain);
                return;
            }
            let url = domain + '/p/index.php?v=' + new Date().getTime();
            console.log('Checking domain:', url);
            $.ajax({
                url: url,
                timeout: domainsChecker.checkDomainTimeout * 1000,
                crossDomain: true,
            }).done((data, g, resp) => {
                console.log('Domain check successful for:', domain, 'Status:', resp.status);
                callback((resp.status === 200 && resp.responseText.length > 0));
            }).fail((jqXHR, textStatus, errorThrown) => {
                console.error('Domain check failed for:', domain, 'Status:', textStatus, 'Error:', errorThrown);
                callback(false);
            });
        },
        processResult: async (result) => {
            const availableDomain = (result || {}).availableDomain;
            if (availableDomain) {
                console.log('Processing result: Available domain found:', availableDomain);
                await browser.storage.local.set({ availableDomain: availableDomain });
                domains.updateList(availableDomain, () => {
                    domainsChecker.saveMetric(availableDomain, () => {
                        browser.tabs.create({url: availableDomain});
                        window.close();
                    });
                });
            } else {
                console.log('Processing result: No available domains found. Displaying message.');
                $('.loading').addClass('hidden');
                $('.no-available-domains #supportEmail').attr('href', `mailto:${supportEmail}`).text(supportEmail);
                $('.no-available-domains').removeClass('hidden');
            }
        },
        // metric for redirects
        saveMetric: (availableDomain, callback) => {
            const url = availableDomain + '/eapi/system/metric';
            console.log('Saving metric for:', availableDomain);
            $.ajax({
                url: url,
                method: 'POST',
                data: {'name': 'BrowserExtensionRedirect', 'value': 1, 'tags': {'extension': 'firefox'}},
                timeout: 7000,
            }).done(() => {
                console.log('Metric saved successfully.');
                callback();
            }).fail((jqXHR, textStatus, errorThrown)=> {
                console.error('Saving metric failed:', textStatus, errorThrown);
                callback();
            });
        }
    }

        domains.getLastAvailableDomain().then((domain) => {
        if (domain) {
            console.log('Last available domain found:', domain);
            domainsChecker.checkDomain(domain, (isAvailable) => {
                if (isAvailable) {
                    domainsChecker.results.availableDomain = domain;
                    domainsChecker.processResult(domainsChecker.results);
                } else {
                    console.log('Last available domain is not available. Running full check.');
                    domainsChecker.run(domainsChecker.processResult);
                }
            });
        } else {
            console.log('No last available domain found. Running full check.');
            domainsChecker.run(domainsChecker.processResult);
        }
    });
})