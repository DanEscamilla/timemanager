"""Hibernate the staging stack when the monthly budget hits 100%."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SSM_PARAM = os.environ["HIBERNATING_PARAMETER"]
ECS_CLUSTER = os.environ["ECS_CLUSTER"]
ECS_SERVICES = [s for s in os.environ["ECS_SERVICES"].split(",") if s]
RDS_IDENTIFIER = os.environ["RDS_IDENTIFIER"]
NAME_PREFIX = os.environ["NAME_PREFIX"]
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))


def _client(service: str, region: str | None = None):
    return boto3.client(service, region_name=region or AWS_REGION)


def set_hibernating() -> None:
    ssm = _client("ssm")
    ssm.put_parameter(Name=SSM_PARAM, Value="true", Type="String", Overwrite=True)
    logger.info("Set %s=true", SSM_PARAM)


def scale_ecs_to_zero() -> None:
    ecs = _client("ecs")
    for service in ECS_SERVICES:
        try:
            ecs.update_service(cluster=ECS_CLUSTER, service=service, desiredCount=0)
            logger.info("ECS service %s desiredCount=0", service)
        except ClientError as exc:
            logger.warning("ECS update %s failed: %s", service, exc)


def stop_rds() -> None:
    rds = _client("rds")
    try:
        rds.stop_db_instance(DBInstanceIdentifier=RDS_IDENTIFIER)
        logger.info("Stopping RDS %s", RDS_IDENTIFIER)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"InvalidDBInstanceState", "DBInstanceNotFound"}:
            logger.info("RDS stop skipped (%s): %s", code, exc)
        else:
            raise


def delete_nat() -> None:
    ec2 = _client("ec2")
    filters = [{"Name": "tag:Name", "Values": [f"{NAME_PREFIX}-nat"]}]
    nats = ec2.describe_nat_gateways(Filters=filters).get("NatGateways", [])
    for nat in nats:
        state = nat.get("State")
        nat_id = nat["NatGatewayId"]
        if state in {"deleted", "deleting"}:
            continue
        allocation_id = None
        for addr in nat.get("NatGatewayAddresses", []):
            allocation_id = addr.get("AllocationId") or allocation_id
        logger.info("Deleting NAT %s", nat_id)
        ec2.delete_nat_gateway(NatGatewayId=nat_id)
        if allocation_id:
            # EIP can only be released after the NAT finishes deleting; best-effort.
            for _ in range(30):
                time.sleep(5)
                current = ec2.describe_nat_gateways(NatGatewayIds=[nat_id])["NatGateways"][0]
                if current.get("State") == "deleted":
                    try:
                        ec2.release_address(AllocationId=allocation_id)
                        logger.info("Released EIP %s", allocation_id)
                    except ClientError as exc:
                        logger.warning("EIP release failed: %s", exc)
                    break


def delete_alb() -> None:
    elbv2 = _client("elbv2")
    name = f"{NAME_PREFIX}-alb"
    try:
        lbs = elbv2.describe_load_balancers(Names=[name]).get("LoadBalancers", [])
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "LoadBalancerNotFound":
            logger.info("ALB %s already gone", name)
            return
        raise
    for lb in lbs:
        arn = lb["LoadBalancerArn"]
        logger.info("Deleting ALB %s", arn)
        elbv2.delete_load_balancer(LoadBalancerArn=arn)


def disable_cloudfront() -> None:
    cf = _client("cloudfront", region="us-east-1")
    marker = None
    while True:
        kwargs: dict[str, Any] = {"MaxItems": "100"}
        if marker:
            kwargs["Marker"] = marker
        page = cf.list_distributions(**kwargs)
        items = (page.get("DistributionList") or {}).get("Items") or []
        for item in items:
            comment = item.get("Comment") or ""
            if not comment.startswith(NAME_PREFIX):
                continue
            dist_id = item["Id"]
            if not item.get("Enabled", False):
                logger.info("CloudFront %s already disabled", dist_id)
                continue
            config_resp = cf.get_distribution_config(Id=dist_id)
            etag = config_resp["ETag"]
            config = config_resp["DistributionConfig"]
            config["Enabled"] = False
            logger.info("Disabling CloudFront %s", dist_id)
            cf.update_distribution(Id=dist_id, IfMatch=etag, DistributionConfig=config)
        if not (page.get("DistributionList") or {}).get("IsTruncated"):
            break
        marker = page["DistributionList"].get("NextMarker")


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    logger.info("Kill switch invoked: %s", json.dumps(event)[:2000])
    set_hibernating()
    scale_ecs_to_zero()
    stop_rds()
    delete_nat()
    delete_alb()
    disable_cloudfront()
    return {"ok": True, "hibernating": True}
