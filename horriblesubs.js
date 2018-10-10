import { config } from "./horriblesubs_config.local.js";
import DelugeRPC from "deluge-rpc";

const PushBullet = require('pushbullet');

let deluge, pusher;

/** DELUGE */
export async function init_deluge() {
    deluge = new DelugeRPC('http://' + config.deluge_host + ':' + config.deluge_port + '/', config.deluge_pass);
    await deluge.auth();
    // get connect status
    const isConnected = await deluge.call('web.connected');

    if (!isConnected)
        // connect to the first host
        await deluge.connect(0)
    else
        console.log('Deluge authenticated successfully...');
};

export async function deluge_call(method, params) {
    return await deluge.call(method, params);
}

export async function attempt_file_rename(unrenamed_torrents) {
    for (let torrent_id of Object.keys(unrenamed_torrents)) {
        // check if there are any files in the torrent yet
        let status = await deluge.call('core.get_torrent_status', [torrent_id, ['files']]);
        // if there are files, then rename them
        if (status.files.length > 0) {
            let out_file = unrenamed_torrents[torrent_id];
            // with HorribleSubs, there's always just one file, at index 0
            await deluge.call('core.rename_files', [torrent_id, [[0, out_file]]])
            // check this torrent off the to-do list
            delete unrenamed_torrents[torrent_id];
        }
    };
    return unrenamed_torrents;
};

/** PUSHBULLET */

// connect to Pushbullet
export function init_pushbullet() {
    if (config.pushbullet_enabled) {
        pusher = new PushBullet(config.pushbullet_access_token);
        console.log('Pushbullet initialized successfully...');
    }
}

// send a Pushbullet notification
export function send_notification(title, body) {
    if (config.pushbullet_enabled) {
        pusher.devices()
            .then((res) => {
                let devices = res.devices;
                devices.forEach(device => {
                    pusher.note(device.iden, 'HS: ' + title, body)
                        .catch(console.log);
                });
            })
            .catch(console.log);
    }
}